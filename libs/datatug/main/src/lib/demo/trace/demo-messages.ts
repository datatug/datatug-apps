// The demo's text, in English and Russian.
//
// The app has no i18n mechanism today, so the demo carries its own small dictionary. Trace steps store a
// message KEY and parameters, never prose, so a stored investigation renders in whichever language the
// visitor has now, and no sentence ever comes from a model.
//
// Syntax: `{name}` is a parameter; `{n, plural, one {…} few {…} many {…} other {…}}` picks a form with
// Intl.PluralRules for the language (`=1 {…}` matches an exact number). Unknown parameters stay visible.
import type { DemoLang } from '../demo-scenarios';
import type { TraceMessage } from '../../chat/chat-trace.types';

type Params = Readonly<Record<string, string | number>>;

const en: Record<string, string> = {
  // page
  'page.title': 'DataTug demo',
  'page.subtitle': 'A real investigation, run in your browser with no AI.',
  'page.sessionNote': 'Demo session: nothing here is saved to an account.',
  'question.label': 'Your question',
  'chooser.heading': 'Pick a scenario',
  'chooser.note': 'Free-form questions need the next release. These curated scenarios run the project’s saved plan, with no AI.',
  'chooser.questionNote': 'This demo cannot answer arbitrary questions yet.',
  'chooser.unknown': '“{scenario}” is not a scenario this demo knows.',
  'chooser.custom': 'Free-form questions arrive in the next release.',
  'chooser.notYet': 'That scenario is not in this release yet.',
  'chooser.run': 'Run this scenario',
  'chooser.unavailable': 'Not in this release',
  'chooser.empty': 'Choose where to start.',
  // trace
  'trace.heading': 'How DataTug assembled the answer',
  'trace.sub': 'Every step below ran in this browser tab. Open one to see its evidence.',
  'trace.noAi': 'No AI was used in this run: 0 tokens.',
  'trace.preview': 'Preview',
  'trace.previewHint': 'Part of this step is not connected yet.',
  'trace.evidence': 'Evidence',
  'trace.mechanism': 'Decided by',
  'trace.provenance': 'Knowledge',
  'trace.duration': '{ms} ms',
  'trace.running': 'Working…',
  'trace.expand': 'Show evidence',
  'trace.collapse': 'Hide evidence',
  'mechanism.deterministic': 'Saved plan and fixed checks',
  'mechanism.cached': 'Remembered decision',
  'mechanism.jev': 'Jev',
  'mechanism.llm': 'Language model',
  'mechanism.human': 'A person',
  'provenance.schema': 'Known from the schema',
  'provenance.declared': 'Declared in the project',
  'provenance.human-confirmed': 'Confirmed by a person',
  'provenance.observed': 'Observed in the data',
  'provenance.verified': 'Verified against the data',
  'provenance.inferred-from-data': 'Inferred from the data',
  'provenance.ai-suggested': 'Suggested by AI',
  'provenance.hypothesis': 'Hypothesis',
  'status.ok': 'Done',
  'status.warning': 'Needs attention',
  'status.failed': 'Failed',
  'status.running': 'Running',
  'status.skipped': 'Skipped',
  // decisions (the question each step answered)
  'decision.plan': 'Which saved plan answers this question?',
  'decision.relevantTables': 'Which tables and fields hold the answer?',
  'decision.meaning': 'What does Invoice.BillingCountry mean?',
  'decision.requiredData': 'What data does the question need that Chinook lacks?',
  'decision.reconcile': 'How do the sources name countries?',
  'decision.mapping': 'Do the names line up across sources?',
  'decision.execute': 'Which sources are joined?',
  'decision.metric': 'How is the measure derived?',
  'decision.presentation': 'How should the answer be shown?',
  'decision.observations': 'What do the result rows say?',
  // trace: understand
  'step.understand.recognised': 'Recognised your question as the demo project’s saved plan “{plan}”.',
  'step.understand.scenario': 'Running the saved plan “{plan}” for the scenario you chose. Your wording was not matched against it.',
  'step.understand.question': 'Question',
  'step.understand.plan': 'Saved query {id} in {project} at commit {commit}',
  // trace: tables and fields
  'step.tables.ok': 'Sales live in Chinook’s Invoice table: Total is the amount and BillingCountry is the country.',
  'step.tables.failed': 'The saved plan names fields that Chinook’s schema does not have: {missing}.',
  'step.tables.field': '{field}: found in the project’s Chinook schema',
  // trace: meaning
  'step.meaning.ok': 'Invoice.BillingCountry is a Country: the project’s Country entity maps it.',
  'step.meaning.none': 'The project does not map Invoice.BillingCountry to a Country.',
  'step.meaning.mapping': '{source}.{collection}.{column} is mapped to Country.{field}',
  'step.meaning.simulated': 'Read from the project’s entity file. The MeaningGraph service is not connected yet.',
  // trace: need a source
  'step.need.ok': 'Population is not in Chinook: none of its {tables} tables has such a field. The saved plan takes it from the World Bank data in the geo source.',
  'step.need.found': 'Chinook has a population field after all: {fields}.',
  'step.need.source': 'World Bank population, indicator SP.POP.TOTL ({license})',
  'step.need.note': 'The source comes from the saved plan. Searching a directory of sources is not built yet.',
  // trace: reconcile
  'step.reconcile.running': 'Comparing how Chinook and the reference data name countries…',
  'step.reconcile.warn': 'The sources name countries differently: {exact} of {total} Chinook countries match the reference names exactly; {manual} needed the project’s alias table.',
  'step.reconcile.ok': 'Mapping resolved: {matched} of {total} billing countries have a population record.',
  'step.reconcile.gap': 'Mapping incomplete: {matched} of {total} billing countries have a population record. Missing: {missing}.',
  'step.reconcile.read': 'Read {rows} {source} records',
  'step.reconcile.alias': '“{alias}” is written “{name}” in the reference data (matched by hand)',
  'step.reconcile.note': 'Exact or manual is read from each alias record’s own source note.',
  // trace: execute
  'step.execute.running': 'Joining three sources in your browser…',
  'step.execute.done': 'Joined three sources in your browser: {invoices} invoices, {aliases} aliases and {population} population records became {rows} rows.',
  'step.execute.reconciled': 'All {invoices} invoices are accounted for: the result adds up to {total}.',
  'step.execute.mismatch': 'The result adds up to {result} but the invoices add up to {invoices}.',
  'step.execute.empty': 'The joined result has no rows.',
  'step.execute.failed': 'Could not read the data: {reason}',
  'step.execute.source': '{source}: {rows} rows read in {requests} {requests, plural, one {request} other {requests}}',
  'step.execute.query': 'DTQL query {id}',
  'step.execute.where': 'Data source: {where}',
  // trace: metric
  'step.metric.ok': 'Calculated sales per million people: total sales divided by population, times 1,000,000.',
  'step.metric.column': 'Result column {column}',
  // trace: present
  'step.present.ok': 'Showing a grid and a bar chart: a ranked amount for each country.',
  'step.present.layout': 'The layout is fixed by this demo scenario',
  // trace: insight
  'step.insight.ok': 'Computed {count} observations from the {rows} result rows. Each links to the rows it rests on.',
  // result
  'result.heading': 'Result',
  'result.rows': '{rows, plural, one {# row} other {# rows}}',
  'result.population': 'Population: World Bank SP.POP.TOTL, {year}',
  'result.chart': 'Sales per million people',
  'result.chartNote': 'Top 10 countries, plus {highlight} for comparison',
  'result.chartAria': 'Bar chart of sales per million people by country',
  'result.gridAria': 'Result grid',
  'result.runAgain': 'Run again',
  'result.clearHighlight': 'Clear the highlighted rows',
  'col.country': 'Country',
  'col.totalSales': 'Total sales',
  'col.population': 'Population',
  'col.populationYear': 'Year',
  'col.salesPerMillion': 'Sales per million',
  // follow-up
  'followup.heading': 'Ask a follow-up',
  'followup.insight': 'What can you say about this data?',
  'followup.more': 'More follow-ups arrive in the next release.',
  'observations.heading': 'What the result says',
  'observations.note': 'Computed from the result rows. No AI wrote this.',
  'observations.rows': 'Show the rows',
  'obs.largestVsRank': '{country} has the largest total ({total}) but ranks number {rank} per person ({perMillion} per million).',
  'obs.largestAlsoFirst': '{country} has the largest total ({total}) and also leads per person ({perMillion} per million).',
  'obs.leaderNear': '{first} leads per person ({a} per million), just ahead of {second} ({b}).',
  'obs.leader': '{first} leads per person ({a} per million); {second} follows with {b}.',
  'obs.small': '{n} of the {k} countries with the most sales per person have under {m} million people.',
  // keep
  'keep.heading': 'Keep this investigation and make it yours',
  'keep.body': 'You can sign in now. Saving this investigation to your account comes in a later release; it stays in this browser until then.',
  'keep.signIn': 'Sign in',
  // honest edges
  'edge.loading': 'Loading the saved plan…',
  'edge.slow': 'This is taking longer than usual. The data is still loading.',
  'edge.sourceDown': 'The demo data source is not reachable ({source}). Nothing was changed.',
  'edge.retry': 'Retry',
  'edge.empty': 'The query returned no rows.',
  'edge.interrupted': 'This run was interrupted before it finished.',
  'edge.failed': 'The demo could not finish: {reason}',
  'edge.workers': 'This browser cannot run the demo’s query worker. Try a current browser.',
  // attribution
  'attribution.heading': 'Data and attribution',
  'attribution.pin': 'Demo project {project} at commit {commit}.',
  'attribution.source': 'Source of these rows: {where}.',
};

const ru: Record<string, string> = {
  'page.title': 'Демо DataTug',
  'page.subtitle': 'Настоящее расследование: выполняется в вашем браузере, без ИИ.',
  'page.sessionNote': 'Демо-сессия: ничего из этого не сохраняется в аккаунт.',
  'question.label': 'Ваш вопрос',
  'chooser.heading': 'Выберите сценарий',
  'chooser.note': 'Произвольные вопросы появятся в следующем релизе. Эти готовые сценарии выполняют сохранённый план проекта, без ИИ.',
  'chooser.questionNote': 'Это демо пока не умеет отвечать на произвольные вопросы.',
  'chooser.unknown': 'Сценарий «{scenario}» этому демо неизвестен.',
  'chooser.custom': 'Произвольные вопросы появятся в следующем релизе.',
  'chooser.notYet': 'Этого сценария пока нет в этом релизе.',
  'chooser.run': 'Запустить сценарий',
  'chooser.unavailable': 'Нет в этом релизе',
  'chooser.empty': 'Выберите, с чего начать.',
  'trace.heading': 'Как DataTug собрал ответ',
  'trace.sub': 'Каждый шаг ниже выполнен в этой вкладке браузера. Откройте шаг, чтобы увидеть доказательства.',
  'trace.noAi': 'В этом запуске ИИ не использовался: 0 токенов.',
  'trace.preview': 'Превью',
  'trace.previewHint': 'Часть этого шага ещё не подключена.',
  'trace.evidence': 'Доказательства',
  'trace.mechanism': 'Кто решил',
  'trace.provenance': 'Происхождение знания',
  'trace.duration': '{ms} мс',
  'trace.running': 'Выполняется…',
  'trace.expand': 'Показать доказательства',
  'trace.collapse': 'Скрыть доказательства',
  'mechanism.deterministic': 'Сохранённый план и фиксированные проверки',
  'mechanism.cached': 'Запомненное решение',
  'mechanism.jev': 'Jev',
  'mechanism.llm': 'Языковая модель',
  'mechanism.human': 'Человек',
  'provenance.schema': 'Известно из схемы',
  'provenance.declared': 'Объявлено в проекте',
  'provenance.human-confirmed': 'Подтверждено человеком',
  'provenance.observed': 'Замечено в данных',
  'provenance.verified': 'Проверено по данным',
  'provenance.inferred-from-data': 'Выведено из данных',
  'provenance.ai-suggested': 'Предложено ИИ',
  'provenance.hypothesis': 'Гипотеза',
  'status.ok': 'Готово',
  'status.warning': 'Требует внимания',
  'status.failed': 'Ошибка',
  'status.running': 'Выполняется',
  'status.skipped': 'Пропущено',
  'decision.plan': 'Какой сохранённый план отвечает на этот вопрос?',
  'decision.relevantTables': 'В каких таблицах и полях лежит ответ?',
  'decision.meaning': 'Что означает Invoice.BillingCountry?',
  'decision.requiredData': 'Каких данных вопросу не хватает в Chinook?',
  'decision.reconcile': 'Как источники называют страны?',
  'decision.mapping': 'Сходятся ли названия в разных источниках?',
  'decision.execute': 'Какие источники объединяются?',
  'decision.metric': 'Как получена величина?',
  'decision.presentation': 'Как показать ответ?',
  'decision.observations': 'Что говорят строки результата?',
  'step.understand.recognised': 'Вопрос распознан как сохранённый план демо-проекта «{plan}».',
  'step.understand.scenario': 'Выполняется сохранённый план «{plan}» для выбранного вами сценария. Ваша формулировка с ним не сопоставлялась.',
  'step.understand.question': 'Вопрос',
  'step.understand.plan': 'Сохранённый запрос {id} в {project}, коммит {commit}',
  'step.tables.ok': 'Продажи лежат в таблице Invoice базы Chinook: Total — сумма, BillingCountry — страна.',
  'step.tables.failed': 'Сохранённый план называет поля, которых нет в схеме Chinook: {missing}.',
  'step.tables.field': '{field}: найдено в схеме Chinook проекта',
  'step.meaning.ok': 'Invoice.BillingCountry — это страна (Country): так записано в сущности Country проекта.',
  'step.meaning.none': 'Проект не связывает Invoice.BillingCountry со страной (Country).',
  'step.meaning.mapping': '{source}.{collection}.{column} связано с Country.{field}',
  'step.meaning.simulated': 'Прочитано из файла сущности проекта. Сервис MeaningGraph ещё не подключён.',
  'step.need.ok': 'Населения нет в Chinook: ни в одной из {tables, plural, one {# таблицы} other {# таблиц}} нет такого поля. Сохранённый план берёт его из данных Всемирного банка в источнике geo.',
  'step.need.found': 'В Chinook всё-таки есть поле населения: {fields}.',
  'step.need.source': 'Население по данным Всемирного банка, показатель SP.POP.TOTL ({license})',
  'step.need.note': 'Источник взят из сохранённого плана. Поиск по каталогу источников ещё не готов.',
  'step.reconcile.running': 'Сравниваем, как Chinook и эталонные данные называют страны…',
  'step.reconcile.warn': 'Источники называют страны по-разному: {exact} из {total} стран Chinook совпали с эталонными названиями точно, {manual} потребовали таблицы псевдонимов проекта.',
  'step.reconcile.ok': 'Соответствие найдено: для {matched} из {total} стран выставления счетов есть запись о населении.',
  'step.reconcile.gap': 'Соответствие неполное: для {matched} из {total} стран выставления счетов есть запись о населении. Нет: {missing}.',
  'step.reconcile.read': 'Прочитано записей {source}: {rows}',
  'step.reconcile.alias': '«{alias}» в эталонных данных записано как «{name}» (сопоставлено вручную)',
  'step.reconcile.note': 'Точное или ручное сопоставление прочитано из пометки об источнике в самой записи псевдонима.',
  'step.execute.running': 'Объединяем три источника в вашем браузере…',
  'step.execute.done': 'Три источника объединены в вашем браузере: {invoices} счетов, {aliases} псевдонимов и {population} записей о населении дали {rows, plural, one {# строку} few {# строки} many {# строк} other {# строки}}.',
  'step.execute.reconciled': 'Все {invoices} счетов учтены: сумма в результате равна {total}.',
  'step.execute.mismatch': 'Сумма в результате {result}, а сумма счетов {invoices}.',
  'step.execute.empty': 'В объединённом результате нет строк.',
  'step.execute.failed': 'Не удалось прочитать данные: {reason}',
  'step.execute.source': '{source}: прочитано строк — {rows}, запросов — {requests}',
  'step.execute.query': 'Запрос DTQL {id}',
  'step.execute.where': 'Источник данных: {where}',
  'step.metric.ok': 'Посчитаны продажи на миллион жителей: сумма продаж, делённая на население, умноженная на 1 000 000.',
  'step.metric.column': 'Столбец результата {column}',
  'step.present.ok': 'Показаны таблица и столбчатая диаграмма: ранжированная величина по каждой стране.',
  'step.present.layout': 'Вид задан сценарием этого демо',
  'step.insight.ok': 'Вычислено наблюдений: {count}, по {rows} строкам результата. Каждое ссылается на строки, на которых основано.',
  'result.heading': 'Результат',
  'result.rows': '{rows, plural, one {# строка} few {# строки} many {# строк} other {# строки}}',
  'result.population': 'Население: Всемирный банк, SP.POP.TOTL, {year} г.',
  'result.chart': 'Продажи на миллион жителей',
  'result.chartNote': '10 лучших стран и {highlight} для сравнения',
  'result.chartAria': 'Столбчатая диаграмма продаж на миллион жителей по странам',
  'result.gridAria': 'Таблица результата',
  'result.runAgain': 'Выполнить снова',
  'result.clearHighlight': 'Снять выделение строк',
  'col.country': 'Страна',
  'col.totalSales': 'Всего продаж',
  'col.population': 'Население',
  'col.populationYear': 'Год',
  'col.salesPerMillion': 'Продаж на миллион',
  'followup.heading': 'Задайте уточняющий вопрос',
  'followup.insight': 'Что можно сказать об этих данных?',
  'followup.more': 'Другие уточняющие вопросы появятся в следующем релизе.',
  'observations.heading': 'Что говорит результат',
  'observations.note': 'Вычислено по строкам результата. ИИ это не писал.',
  'observations.rows': 'Показать строки',
  'obs.largestVsRank': '{country}: самая большая сумма ({total}), но на душу населения — на {rank}-м месте ({perMillion} на миллион).',
  'obs.largestAlsoFirst': '{country}: самая большая сумма ({total}), и также первое место на душу населения ({perMillion} на миллион).',
  'obs.leaderNear': '{first} лидирует на душу населения ({a} на миллион), совсем немного впереди {second} ({b}).',
  'obs.leader': '{first} лидирует на душу населения ({a} на миллион); {second} следом — {b}.',
  'obs.small': 'Среди {k} стран с наибольшими продажами на душу населения у {n} население меньше {m} млн человек.',
  'keep.heading': 'Сохраните это расследование и сделайте его своим',
  'keep.body': 'Войти можно уже сейчас. Сохранение расследования в аккаунт появится в одном из следующих релизов; пока оно хранится в этом браузере.',
  'keep.signIn': 'Войти',
  'edge.loading': 'Загружаем сохранённый план…',
  'edge.slow': 'Это занимает больше времени, чем обычно. Данные всё ещё загружаются.',
  'edge.sourceDown': 'Источник данных демо недоступен ({source}). Ничего не изменилось.',
  'edge.retry': 'Повторить',
  'edge.empty': 'Запрос не вернул ни одной строки.',
  'edge.interrupted': 'Этот запуск был прерван до завершения.',
  'edge.failed': 'Демо не удалось завершить: {reason}',
  'edge.workers': 'Этот браузер не может запустить фоновый обработчик запроса демо. Попробуйте актуальный браузер.',
  'attribution.heading': 'Данные и авторство',
  'attribution.pin': 'Демо-проект {project}, коммит {commit}.',
  'attribution.source': 'Источник этих строк: {where}.',
};

export const DEMO_MESSAGES: Readonly<Record<DemoLang, Readonly<Record<string, string>>>> = { en, ru };

function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `one {…} few {…} other {…}` and `=1 {…}` as a map from selector to text. */
function pluralForms(body: string): Record<string, string> {
  const forms: Record<string, string> = {};
  const pattern = /\s*(=\d+|\w+)\s*\{/y;
  let at = 0;
  for (;;) {
    pattern.lastIndex = at;
    const head = pattern.exec(body);
    if (!head) break;
    const open = head.index + head[0].length - 1;
    const end = closeOf(body, open);
    if (end < 0) break;
    forms[head[1]] = body.slice(open + 1, end);
    at = end + 1;
  }
  return forms;
}

function plural(lang: DemoLang, body: string, value: number, params: Params): string {
  const forms = pluralForms(body);
  const chosen = forms[`=${value}`] ?? forms[new Intl.PluralRules(lang).select(value)] ?? forms['other'] ?? '';
  return format(lang, chosen.replace(/#/g, String(value)), params);
}

function format(lang: DemoLang, template: string, params: Params): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '{') { out += template[i]; continue; }
    const end = closeOf(template, i);
    if (end < 0) { out += template.slice(i); break; }
    const inner = template.slice(i + 1, end);
    const head = /^\s*(\w+)\s*,\s*plural\s*,/.exec(inner);
    if (head) {
      const value = Number(params[head[1]]);
      out += plural(lang, inner.slice(head[0].length), value, params);
    } else {
      const value = params[inner.trim()];
      out += value === undefined ? `{${inner}}` : String(value);
    }
    i = end;
  }
  return out;
}

/** Render a dictionary message. An unknown key renders as itself, so a gap shows up in review and in tests. */
export function renderMessage(lang: DemoLang, key: string, params: Params = {}): string {
  const template = DEMO_MESSAGES[lang][key] ?? DEMO_MESSAGES['en'][key];
  return template === undefined ? key : format(lang, template, params);
}

export function renderTraceMessage(lang: DemoLang, message: TraceMessage): string {
  return renderMessage(lang, message.key, message.params);
}

/** The placeholder names a template uses, including plural selectors: for the dictionary parity test. */
export function placeholders(template: string): readonly string[] {
  const names = new Set<string>();
  const walk = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') continue;
      const end = closeOf(text, i);
      if (end < 0) return;
      const inner = text.slice(i + 1, end);
      const head = /^\s*(\w+)\s*,\s*plural\s*,/.exec(inner);
      if (head) {
        names.add(head[1]);
        for (const form of Object.values(pluralForms(inner.slice(head[0].length)))) walk(form);
      } else if (/^\w+$/.test(inner.trim())) names.add(inner.trim());
      else walk(inner);
      i = end;
    }
  };
  walk(template);
  return [...names].sort();
}
