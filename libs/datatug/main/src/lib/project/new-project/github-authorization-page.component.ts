import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import { filter, switchMap, take, Subject, takeUntil } from 'rxjs';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButton,
} from '@ionic/angular';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { NewProjectService } from './new-project.service';

declare global {
  interface Window {
    __datatugTakeGitHubAuthorization?: () =>
      | { code: string; state: string }
      | undefined;
  }
}

@Component({
  selector: 'sneat-datatug-github-authorization-page',
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButton],
  providers: [NewProjectService],
  template: `<ion-header
      ><ion-toolbar
        ><ion-title>Connect GitHub</ion-title></ion-toolbar
      ></ion-header
    >
    <ion-content class="ion-padding"
      ><p>{{ message() }}</p>
      @if (needsSignIn()) {
        <ion-button (click)="signIn()">Sign in to DataTug</ion-button>
      }
      @if (connected()) {
        <ion-button (click)="newProject()">Create a project</ion-button>
      }
      <ion-button href="/" fill="clear"
        >Back to projects</ion-button
      ></ion-content
    >`,
})
export class GithubAuthorizationPageComponent {
  private readonly auth = inject(SneatAuthStateService);
  private readonly connection = inject(GithubConnectionService);
  private readonly newProjectService = inject(NewProjectService);
  private readonly destroyRef = inject(DestroyRef);
  readonly message = signal('Checking your DataTug sign-in…');
  readonly connected = signal(false);
  readonly needsSignIn = signal(false);
  private boundUserID?: string;
  private readonly authChanged = new Subject<void>();

  constructor() {
    const authorization = window.__datatugTakeGitHubAuthorization?.();
    delete window.__datatugTakeGitHubAuthorization;
    if (!authorization) {
      this.message.set(
        'This connection return is missing or has already been used. Start Connect GitHub again.',
      );
      return;
    }
    this.auth.authState
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((auth) => {
        this.needsSignIn.set(auth.status === 'notAuthenticated');
        if (
          this.boundUserID &&
          (auth.status !== 'authenticated' ||
            auth.user?.uid !== this.boundUserID)
        ) {
          this.authChanged.next();
          this.connected.set(false);
          this.message.set('Your sign-in changed. Start Connect GitHub again.');
        }
      });
    this.auth.authState
      .pipe(
        filter((auth) => auth.status === 'authenticated' && !!auth.user?.uid),
        take(1),
        switchMap((auth) => {
          this.boundUserID = auth.user?.uid;
          return this.connection.complete(
            authorization.code,
            authorization.state,
          );
        }),
        takeUntil(this.authChanged),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          if (result.connected === true) {
            this.connected.set(true);
            this.message.set(
              'GitHub is connected. Choose an initialized repository and branch to create your project.',
            );
          }
        },
        error: () =>
          this.message.set(
            'GitHub could not be connected. Start Connect GitHub again; no credentials were saved in this browser.',
          ),
      });
  }
  signIn(): void {
    void this.auth
      .signInWith('google.com')
      .catch(() =>
        this.message.set('Sign-in could not be completed. Please try again.'),
      );
  }
  newProject(): void {
    this.newProjectService.openNewProjectDialog('github');
  }
}
