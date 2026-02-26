import { computed, effect, signal } from './signal.js';

const apiBaseUrl = signal('http://localhost:3000');
const resources = signal([]);
const selectedResourceName = signal(null);
const queryText = signal('');
const tableRows = signal([]);
const selectedItem = signal({});
const resultSummary = signal('');
const status = signal('Idle');
const errorMessage = signal('');

const selectedResource = computed(() => {
  const activeName = selectedResourceName.get();
  if (!activeName) {
    return null;
  }
  return resources.get().find((resource) => resource.name === activeName) ?? null;
}, [resources, selectedResourceName]);

const elements = {
  apiUrlInput: document.querySelector('#api-url'),
  connectButton: document.querySelector('#connect-btn'),
  statusBadge: document.querySelector('#status-badge'),
  resourcesList: document.querySelector('#resources-list'),
  queryInput: document.querySelector('#query-input'),
  runQueryButton: document.querySelector('#run-query-btn'),
  resourceTitle: document.querySelector('#resource-title'),
  resultSummary: document.querySelector('#result-summary'),
  table: document.querySelector('#result-table'),
  detailsJson: document.querySelector('#details-json'),
  errorMessage: document.querySelector('#error-message')
};

if (
  !elements.apiUrlInput ||
  !elements.connectButton ||
  !elements.statusBadge ||
  !elements.resourcesList ||
  !elements.queryInput ||
  !elements.runQueryButton ||
  !elements.resourceTitle ||
  !elements.resultSummary ||
  !elements.table ||
  !elements.detailsJson ||
  !elements.errorMessage
) {
  throw new Error('Playground UI failed to initialize');
}

elements.connectButton.addEventListener('click', () => {
  void connect();
});

elements.queryInput.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    queryText.set(target.value);
  }
});

elements.runQueryButton.addEventListener('click', () => {
  void loadSelectedResource();
});

effect(() => {
  elements.statusBadge.textContent = status.get();
}, [status]);

effect(() => {
  const message = errorMessage.get();
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.toggle('hidden', message.length === 0);
}, [errorMessage]);

effect(() => {
  renderResources();
}, [resources, selectedResourceName]);

effect(() => {
  const activeResource = selectedResource.get();
  elements.resourceTitle.textContent = activeResource ? activeResource.name : 'No resource selected';
}, [selectedResource]);

effect(() => {
  elements.resultSummary.textContent = resultSummary.get();
}, [resultSummary]);

effect(() => {
  renderTable();
}, [tableRows, selectedResource]);

effect(() => {
  elements.detailsJson.textContent = JSON.stringify(selectedItem.get(), null, 2);
}, [selectedItem]);

void initialize();

async function initialize() {
  const config = await loadConfig();
  apiBaseUrl.set(config.apiBaseUrl);
  elements.apiUrlInput.value = config.apiBaseUrl;
  await connect();
}

async function connect() {
  const nextBase = normalizeApiBaseUrl(elements.apiUrlInput.value);
  apiBaseUrl.set(nextBase);
  errorMessage.set('');
  status.set('Connecting...');

  try {
    const root = await requestJson('/');
    const discoveredResources = await discoverResources(root);

    resources.set(discoveredResources);
    selectedResourceName.set(discoveredResources[0]?.name ?? null);
    selectedItem.set({});
    queryText.set('');
    elements.queryInput.value = '';

    if (discoveredResources.length === 0) {
      tableRows.set([]);
      resultSummary.set('No resources discovered in the API root object.');
      status.set('Connected');
      return;
    }

    await loadSelectedResource();
    status.set('Connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessage.set(message);
    status.set('Failed');
  }
}

async function loadSelectedResource() {
  const resource = selectedResource.get();
  if (!resource) {
    tableRows.set([]);
    selectedItem.set({});
    resultSummary.set('Select a resource to query.');
    return;
  }

  const suffix = normalizeQueryString(queryText.get());
  const path = `/${resource.name}${suffix}`;
  status.set('Loading...');
  errorMessage.set('');

  try {
    const payload = await requestJson(path);
    if (resource.kind === 'singular') {
      tableRows.set([]);
      selectedItem.set(payload);
      resultSummary.set('Singular resource loaded.');
      status.set('Connected');
      return;
    }

    const rows = unwrapCollectionResponse(payload);
    tableRows.set(rows);
    selectedItem.set(rows[0] ?? {});
    resultSummary.set(`Loaded ${rows.length} records from "${resource.name}".`);
    status.set('Connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessage.set(message);
    status.set('Failed');
  }
}

async function discoverResources(rootPayload) {
  if (!isPlainObject(rootPayload)) {
    throw new Error('API root must return a JSON object');
  }

  if (
    Array.isArray(rootPayload.resources) &&
    rootPayload.resources.every((entry) => typeof entry === 'string')
  ) {
    const names = rootPayload.resources;
    const resolved = await Promise.all(
      names.map(async (name) => {
        try {
          const encoded = encodeURIComponent(name);
          const payload = await requestJson(`/${encoded}?_limit=1`);
          if (Array.isArray(payload)) {
            return { name, kind: 'collection' };
          }
          if (isPlainObject(payload) && Array.isArray(payload.data)) {
            return { name, kind: 'collection' };
          }
          if (isPlainObject(payload)) {
            return { name, kind: 'singular' };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    return resolved.filter((entry) => entry !== null);
  }

  return Object.entries(rootPayload).flatMap(([name, value]) => {
    if (Array.isArray(value)) {
      return [{ name, kind: 'collection' }];
    }
    if (isPlainObject(value)) {
      return [{ name, kind: 'singular' }];
    }
    return [];
  });
}

function renderResources() {
  const list = resources.get();
  const active = selectedResourceName.get();

  elements.resourcesList.innerHTML = '';
  for (const resource of list) {
    const button = document.createElement('button');
    button.className = `resource-link${resource.name === active ? ' active' : ''}`;
    button.textContent = `${resource.name} (${resource.kind})`;
    button.addEventListener('click', () => {
      selectedResourceName.set(resource.name);
      void loadSelectedResource();
    });
    elements.resourcesList.append(button);
  }
}

function renderTable() {
  const resource = selectedResource.get();
  const rows = tableRows.get();
  elements.table.innerHTML = '';

  if (!resource || resource.kind !== 'collection') {
    return;
  }

  if (rows.length === 0) {
    const body = document.createElement('tbody');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'muted';
    cell.textContent = 'No records';
    row.append(cell);
    body.append(row);
    elements.table.append(body);
    return;
  }

  const columns = collectColumns(rows);
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.textContent = column;
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  for (const rowData of rows) {
    const row = document.createElement('tr');
    row.className = 'clickable';
    row.addEventListener('click', () => {
      selectedItem.set(rowData);
    });

    for (const column of columns) {
      const cell = document.createElement('td');
      cell.textContent = summarizeValue(rowData[column]);
      row.append(cell);
    }
    body.append(row);
  }

  elements.table.append(head, body);
}

async function requestJson(pathname) {
  const baseUrl = ensureBasePath(apiBaseUrl.get());
  const absoluteUrl = new URL(pathname.replace(/^\//u, ''), baseUrl);
  const response = await fetch(absoluteUrl, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${absoluteUrl.pathname}`);
  }

  const payloadText = await response.text();
  try {
    return JSON.parse(payloadText);
  } catch {
    throw new Error(`Response is not JSON: ${absoluteUrl.pathname}`);
  }
}

function unwrapCollectionResponse(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isPlainObject(payload) && Array.isArray(payload.data)) {
    return payload.data;
  }
  throw new Error('Collection response must be an array or pagination object with `data` array');
}

function collectColumns(rows) {
  const columns = [];
  const seen = new Set();
  for (const row of rows.slice(0, 20)) {
    if (!isPlainObject(row)) {
      continue;
    }
    for (const key of Object.keys(row)) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      columns.push(key);
    }
  }
  return columns.slice(0, 8);
}

function summarizeValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (isPlainObject(value)) {
    return '{...}';
  }
  return String(value);
}

function normalizeApiBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('API base URL is required');
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API base URL must start with http:// or https://');
  }

  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');

  return parsed.toString().replace(/\/$/u, '');
}

function normalizeQueryString(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('?')) {
    return trimmed;
  }
  return `?${trimmed}`;
}

function ensureBasePath(baseUrl) {
  if (baseUrl.endsWith('/')) {
    return baseUrl;
  }
  return `${baseUrl}/`;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadConfig() {
  try {
    const response = await fetch('./config.json', {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('config unavailable');
    }

    const payload = await response.json();
    if (!isPlainObject(payload) || typeof payload.apiBaseUrl !== 'string') {
      throw new Error('invalid config');
    }

    return {
      apiBaseUrl: normalizeApiBaseUrl(payload.apiBaseUrl)
    };
  } catch {
    return {
      apiBaseUrl: 'http://localhost:3000'
    };
  }
}
