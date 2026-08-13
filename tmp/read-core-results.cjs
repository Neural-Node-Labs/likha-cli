// ronin:version 2 | ronin:task task-4508cb | ronin:updated 2026-08-13T15:46:00.377Z | ronin:subtask test-st-ec8121
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('tmp/core-tests-final.json', 'utf-8'));
console.log('SUITE SUCCESS:', data.success);
console.log('TOTAL:', data.numTotalTests, 'PASSED:', data.numPassedTests, 'FAILED:', data.numFailedTests);
for (const suite of data.testResults) {
  for (const a of suite.assertionResults) {
    if (a.status === 'failed') {
      console.log('\nFAILED TEST:', a.fullName);
      console.log('FILE:', suite.name);
      for (const m of a.failureMessages || []) console.log(m);
    }
  }
}
