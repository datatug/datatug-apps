// prepare-browser-fixture creates the isolated synthetic project used by the
// Context Bag browser journey. Run this file from the datatug-cli module root
// so its module dependencies resolve; it deliberately starts no server.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/dal-go/dalgo/access"
	"github.com/datatug/datatug-cli/pkg/api"
	"github.com/datatug/datatug-cli/pkg/detective"
	"github.com/datatug/datatug-cli/pkg/secureread"
	"github.com/datatug/datatug-core/pkg/apicontract"
	"github.com/datatug/datatug-core/pkg/datatug"
	"github.com/datatug/datatug-core/pkg/sessioncontext"
	"github.com/datatug/datatug-core/pkg/storage"
	"github.com/datatug/datatug-core/pkg/storage/filestore"
)

const (
	fixtureID       = "context-native-fixture"
	fixtureActor    = "context-fixture-owner"
	chinookSHA256   = "7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15"
	chinookByteSize = 1007616
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "prepare-browser-fixture: %v\n", err)
		os.Exit(2)
	}
}

func run() error {
	rootArg := flag.String("root", "", "new, nonexistent directory for this fixture")
	sqliteArg := flag.String("sqlite", "", "path to the public Chinook SQLite file")
	flag.Parse()

	if *rootArg == "" || *sqliteArg == "" {
		return fmt.Errorf("both --root and --sqlite are required")
	}
	root, err := filepath.Abs(*rootArg)
	if err != nil {
		return fmt.Errorf("resolve --root: %w", err)
	}
	if root == string(filepath.Separator) {
		return fmt.Errorf("refusing filesystem root")
	}

	if _, err := os.Lstat(root); err == nil {
		return fmt.Errorf("refusing existing --root %q; choose a new path", root)
	} else if !errorsIsNotExist(err) {
		return fmt.Errorf("inspect --root: %w", err)
	}

	sqlitePath, err := filepath.Abs(*sqliteArg)
	if err != nil {
		return fmt.Errorf("resolve --sqlite: %w", err)
	}
	info, err := os.Stat(sqlitePath)
	if err != nil {
		return fmt.Errorf("inspect --sqlite: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() != chinookByteSize {
		return fmt.Errorf("--sqlite must be a regular %d-byte Chinook file", chinookByteSize)
	}
	sqlite, err := os.ReadFile(sqlitePath)
	if err != nil {
		return fmt.Errorf("read --sqlite: %w", err)
	}
	if len(sqlite) != chinookByteSize {
		return fmt.Errorf("Chinook fixture size mismatch: got %d bytes", len(sqlite))
	}
	digest := sha256.Sum256(sqlite)
	if got := hex.EncodeToString(digest[:]); got != chinookSHA256 {
		return fmt.Errorf("Chinook fixture checksum mismatch: got %s", got)
	}

	if err := os.Mkdir(root, 0o700); err != nil {
		return fmt.Errorf("create new --root: %w", err)
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.RemoveAll(root)
		}
	}()
	if err := createFixture(root, sqlite); err != nil {
		return fmt.Errorf("create fixture: %w", err)
	}
	complete = true
	fmt.Printf("Prepared synthetic browser fixture under %s; session=native-fixture-session check=invoice-check case=native-fixture-case. No server or source query was started.\n", root)
	return nil
}

func errorsIsNotExist(err error) bool {
	return err != nil && errors.Is(err, os.ErrNotExist)
}

func createFixture(root string, sqlite []byte) error {
	project := filepath.Join(root, "project")
	private := filepath.Join(root, "private")
	if err := os.MkdirAll(private, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(project, "policies"), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(project, "chinook.sqlite"), sqlite, 0o600); err != nil {
		return err
	}

	ctx := context.Background()
	filestore.SetProjectPath(fixtureID, project)
	store := filestore.NewProjectStore(fixtureID, project)
	model := &datatug.Project{Created: &datatug.ProjectCreated{At: time.Now().UTC()}}
	model.ID, model.Title, model.Access = fixtureID, "Native Context Chinook proof fixture", "private"
	if err := store.SaveProject(ctx, model); err != nil {
		return err
	}

	environment := &datatug.Environment{
		DbServers: datatug.EnvDbServers{{
			ServerRef: datatug.ServerRef{Driver: "sqlite3"},
			Catalogs:  []string{"chinook"},
		}},
	}
	environment.ID = "local"
	if err := store.SaveEnvironment(ctx, environment); err != nil {
		return err
	}
	serverID := (&datatug.EnvDbServer{ServerRef: datatug.ServerRef{Driver: "sqlite3"}}).GetID()
	catalog := &datatug.DbCatalog{
		DbCatalogBase: datatug.DbCatalogBase{
			Driver: "sqlite3", Path: filepath.Join(project, "chinook.sqlite"), DbModel: "chinook",
		},
	}
	catalog.ID = "chinook"
	if err := store.SaveEnvDbCatalog(ctx, "local", serverID, "chinook", catalog); err != nil {
		return err
	}

	query := &datatug.QueryDefWithFolderPath{}
	query.ID, query.Title, query.Type, query.ConnectionID = "invoice-detail", "Invoice detail", datatug.QueryTypeTugQL, "chinook-sqlite"
	query.Text = "from:\n  name: Invoice\nwhere:\n  op: \"==\"\n  left:\n    field: InvoiceId\n  right:\n    param: InvoiceId\n"
	if err := json.Unmarshal([]byte(`[{"id":"InvoiceId","type":"integer","isRequired":true}]`), &query.Parameters); err != nil {
		return err
	}
	if _, err := store.(datatug.RevisionedQueriesStore).PutQuery(ctx, query, datatug.QueryWriteCondition{IfNoneMatch: true}); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(project, "connections"), 0o700); err != nil {
		return err
	}
	connections := []byte(`{"format":"datatug-demo-connections/v1","connections":[{"id":"chinook-sqlite","dataset":"chinook","storage":"sqlite","readiness":"public-api","source":"https://demodb.dev/ovdb/v1/databases/chinook","fixtureSha256":"7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15","browserFixture":{"url":"https://chinook.demodb.dev/data/chinook.sqlite","bytes":1007616}}]}`)
	if err := os.WriteFile(filepath.Join(project, "connections", "demo-db.json"), connections, 0o600); err != nil {
		return err
	}

	paths := map[string]string{fixtureID: project}
	storage.NewDatatugStore = func(string) (storage.Store, error) {
		return filestore.NewStore("files", paths)
	}
	api.ConfigureSecureSession(
		secureread.Session{Principal: &access.Principal{ID: fixtureActor}, Unrestricted: true},
		paths,
		api.Capabilities{AllowWrites: true, NativeSessionDetective: true, EvidencePrivateDir: private},
	)
	service, projectRef, capabilities, err := api.ResolveSessionContext(ctx, "local", fixtureID)
	if err != nil {
		return err
	}
	defer api.CloseSessionContext()
	if len(capabilities.Subjects) != 1 || len(capabilities.Environments) != 1 || len(capabilities.Environments[0].QuerySources) != 1 {
		return fmt.Errorf("fixture source metadata was not independently admitted")
	}
	scope := sessioncontext.Scope{
		EnvironmentID:  capabilities.Environments[0].EnvironmentID,
		IdentityDomain: capabilities.Environments[0].IdentityDomain,
	}
	created, err := service.Execute(ctx, projectRef, sessioncontext.Command{
		OpID: "fixture-create", Action: "createSession", SessionID: "native-fixture-session",
		BagID: "native-fixture-bag", DatabaseID: projectRef.DatabaseID, ProjectID: projectRef.ProjectID,
		Title: "Native investigation", Scope: &scope,
	})
	if err != nil {
		return err
	}
	value := apicontract.NewIntegerValue("5")
	put, err := service.Execute(ctx, projectRef, sessioncontext.Command{
		OpID: "fixture-put", Action: "putEntry", SessionID: "native-fixture-session",
		ExpectedVersion: created.Receipt.SessionVersion, BagID: "native-fixture-bag", ExpectedBagVersion: 1,
		EntryID: "invoice-id", RevisionID: "invoice-id-r1", Alias: "Selected invoice",
		Subject: &capabilities.Subjects[0].Subject,
		Value:   &sessioncontext.ValueEnvelope{SchemaVersion: 1, Kind: "scalar", Scalar: &value},
	})
	if err != nil {
		return err
	}
	snapshot, err := service.GetSnapshot(ctx, projectRef, "native-fixture-session")
	if err != nil {
		return err
	}
	native, err := detective.NewLocalStore(fixtureID, project, private)
	if err != nil {
		return err
	}
	expected := apicontract.NewIntegerValue("1")
	if _, err := native.SaveCheck(ctx, detective.Check{
		ID: "invoice-check", Title: "Selected invoice exists",
		Inputs: []detective.Input{{Name: "InvoiceId", Type: apicontract.ValueTypeInteger, Cardinality: "scalar", Required: true}},
		Steps: []detective.Step{{
			ID: "invoice", Kind: "query", QueryID: "invoice-detail",
			Bindings:   []detective.Binding{{Input: "InvoiceId", FromInput: "InvoiceId"}},
			Validators: []detective.Validator{{ID: "one-invoice", Kind: "row-count", Scope: "set", Severity: "error", Expected: &expected}},
		}},
	}, fixtureActor); err != nil {
		return err
	}
	if _, err := native.SaveCase(ctx, detective.Case{ID: "native-fixture-case", Title: "Invoice investigation"}, fixtureActor, "create-case"); err != nil {
		return err
	}
	request := api.SessionDetectiveRequest{
		OperationID: "native-fixture-op", SessionID: "native-fixture-session",
		ExpectedVersion: put.Receipt.SessionVersion, ExpectedContextSetID: snapshot.ContextSet.ID,
		Scope: scope, CheckID: "invoice-check", CaseID: "native-fixture-case",
		Attachments: []sessioncontext.EntryRef{{EntryID: "invoice-id", RevisionID: "invoice-id-r1"}},
		Bindings:    []api.SessionDetectiveInputSelection{{InputName: "InvoiceId", EntryID: "invoice-id", RevisionID: "invoice-id-r1"}},
	}
	for name, value := range map[string]any{
		"request.json":         request,
		"operation-scope.json": capabilities.OperationScope,
		"capabilities.json":    capabilities,
	} {
		if err := saveJSON(filepath.Join(root, name), value); err != nil {
			return err
		}
	}
	return nil
}

func saveJSON(path string, value any) error {
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o600)
}
