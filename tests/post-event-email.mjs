import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('lib/postEventEmail.ts', 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const parsed = helpers.parseAdditionalRecipients(
  ' extra@example.com;SECOND@example.com, extra@example.com ; dan.crain@rodinmotorsport.com ',
);
assert.deepEqual(parsed.invalid, []);
assert.deepEqual(parsed.recipients, [
  'extra@example.com',
  'second@example.com',
  'dan.crain@rodinmotorsport.com',
]);

const recipients = helpers.buildPostEventRecipients(parsed.recipients);
assert.deepEqual(recipients, [
  'dan.crain@rodinmotorsport.com',
  'jimmy@rodinmotorsport.com',
  'extra@example.com',
  'second@example.com',
]);

assert.deepEqual(
  helpers.parseAdditionalRecipients('valid@example.com; invalid; also@bad').invalid,
  ['invalid', 'also@bad'],
);
assert.deepEqual(helpers.buildPostEventRecipients([]), [
  'dan.crain@rodinmotorsport.com',
  'jimmy@rodinmotorsport.com',
]);

console.log('PASS: default recipients, comma/semicolon parsing, trimming, multiple additions, case-insensitive deduplication, and invalid-address detection');
