import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const evalsDir = path.join(repoRoot, 'evals');

const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function validateEvalsJson() {
  const evals = await readJson(path.join(evalsDir, 'evals.json'));
  check('evals.json has expected skill name', evals.skill_name === 'passkeys-auth-migration');
  check('evals.json has eval array', Array.isArray(evals.evals));

  const seenIds = new Set();
  for (const item of evals.evals ?? []) {
    check(`eval ${item.id} has unique numeric id`, Number.isInteger(item.id) && !seenIds.has(item.id));
    seenIds.add(item.id);
    check(`eval ${item.id} has prompt`, typeof item.prompt === 'string' && item.prompt.trim().length > 0);
    check(`eval ${item.id} has expected_output`, typeof item.expected_output === 'string' && item.expected_output.trim().length > 0);
    check(`eval ${item.id} has assertions`, Array.isArray(item.assertions) && item.assertions.length > 0);
    check(`eval ${item.id} has explicit should_trigger`, typeof item.should_trigger === 'boolean');
  }

  check('eval suite keeps positive and negative trigger coverage',
    evals.evals?.some((item) => item.should_trigger === true) &&
    evals.evals?.some((item) => item.should_trigger === false));
}

async function validateSkillRouting(corpus) {
  const skill = await fs.readFile(path.join(repoRoot, 'SKILL.md'), 'utf8');
  const normalizedSkill = normalizeText(skill);

  const routingPatterns = [
    'debugging an existing passkey/WebAuthn flow',
    'test passkey endpoints',
    'passkey autofill not showing',
    'general passkey security/comparison explainers',
    'Troubleshooting an existing passkey flow',
    'Testing or CI for passkey flows',
    'BACKEND CONTEXT (required for frontend-only passkey integration)',
  ];

  for (const pattern of routingPatterns) {
    check(`SKILL.md routing covers "${pattern}"`, normalizedSkill.includes(normalizeText(pattern)));
  }

  const troubleshootingPatterns = [
    'references/troubleshooting.md',
    'autocomplete="username webauthn"',
    'useBrowserAutofill: true',
    "mediation: 'conditional'",
    'allowCredentials: []',
    'Private browsing',
  ];

  for (const pattern of troubleshootingPatterns) {
    check(`troubleshooting guidance covers "${pattern}"`, corpus.includes(normalizeText(pattern)));
  }

  const testingPatterns = [
    'references/testing-guide.md',
    'mock @simplewebauthn/server',
    'deletes challenge even when verification fails',
    'Chrome DevTools Protocol',
    'addVirtualAuthenticator',
    'RP_ID=localhost',
    'APP_ORIGIN',
  ];

  for (const pattern of testingPatterns) {
    check(`testing guidance covers "${pattern}"`, corpus.includes(normalizeText(pattern)));
  }
}

function validateV120Features(corpus) {
  const v120Patterns = [
    'conditionalCreate',
    'useAutoRegister',
    "uiMode: 'immediate'",
    'signalCurrentUserDetails',
    '/.well-known/webauthn',
    '"origins"',
    'preferredAuthenticatorType',
    'publickey-credentials-get',
    'Firefox 152',
  ];

  for (const pattern of v120Patterns) {
    check(`v1.2.0 feature coverage includes "${pattern}"`, corpus.includes(normalizeText(pattern)));
  }
}

async function main() {
  const referenceFiles = [
    'SKILL.md',
    'references/library-matrix.md',
    'references/db-schema.md',
    'references/backend-integration.md',
    'references/frontend-integration.md',
    'references/security-checklist.md',
    'references/testing-guide.md',
    'references/troubleshooting.md',
    'references/rollout-guide.md',
    'references/advanced-features.md',
    'assets/env-template.md',
  ];

  const corpusParts = [];
  for (const file of referenceFiles) {
    corpusParts.push(await fs.readFile(path.join(repoRoot, file), 'utf8'));
  }
  const corpus = normalizeText(corpusParts.join('\n'));

  await validateEvalsJson();
  await validateSkillRouting(corpus);
  validateV120Features(corpus);

  const failed = checks.filter((item) => !item.ok);
  for (const item of checks) {
    const mark = item.ok ? 'PASS' : 'FAIL';
    const suffix = item.detail ? ` (${item.detail})` : '';
    console.log(`${mark} ${item.name}${suffix}`);
  }

  const passed = checks.length - failed.length;
  console.log(`\n${passed}/${checks.length} checks passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
