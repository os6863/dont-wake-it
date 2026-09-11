const fs = require('fs');
const path = require('path');
const solc = require('solc');

function findImports(importPath) {
  // Resolve relative to contracts/
  const base = path.join(__dirname, '..', 'contracts');
  const full = path.normalize(path.join(base, importPath.startsWith('./') || importPath.startsWith('../') ? importPath : importPath));
  try {
    return { contents: fs.readFileSync(full, 'utf8') };
  } catch (e) {
    return { error: 'File not found: ' + importPath };
  }
}

const source = fs.readFileSync(require('path').join(__dirname,'..','contracts','DontWakeIt.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: {
    'DontWakeIt.sol': { content: source },
  },
  settings: {
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hasError = false;
if (output.errors) {
  for (const err of output.errors) {
    console.log(err.severity.toUpperCase() + ': ' + err.formattedMessage);
    if (err.severity === 'error') hasError = true;
  }
}
if (!hasError) {
  console.log('\n✅ Compiled successfully, no errors.');
  const abi = output.contracts['DontWakeIt.sol']['DontWakeIt'].abi;
  fs.writeFileSync('DontWakeIt.abi.json', JSON.stringify(abi, null, 2));
} else {
  process.exit(1);
}
