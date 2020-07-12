const fs = require('fs');

(async () => {
  const content = fs.readFileSync('/Users/pfeldman/code/playwright/test/page.spec.js').toString();
  const lines = content.split('\n');
  for (let line of lines) {
    if (line.trim().startsWith('describe')) {
      console.log('# DESCRIBE ' + line)
      continue;
    }
    if (line.trim() === '});') {
      console.log('');
      continue;
    }

    let match = line.match(/it.*\(\'([^']+)\'.*async(?: function)?\({(.*)}\).*/);
    if (match) {
      console.log(`  async def test_${match[1].replace(/[- =]|\[|\]|\>|\</g, '_')}(${match[2]}):`);
      continue;
    }

    line = line.replace(/;$/g, '');
    line = line.replace(/ const /g, ' ');
    line = line.replace(/ let /g, ' ');
    line = line.replace(/ = null/g, ' = None');
    line = line.replace('await Promise.all([', 'await asyncio.gather(');
    line = line.replace(/\.\$\(/, '.querySelector(');
    line = line.replace(/\.\$$\(/, '.querySelectorAll(');
    line = line.replace(/\.\$eval\(/, '.evalOnSelector(');
    line = line.replace(/\.\$$eval\(/, '.evalOnSelectorAll(');

    match = line.match(/(\s+)expect\((.*)\).toEqual\((.*)\)/)
    if (match)
      line = `${match[1]}assert ${match[2]} == ${match[3]}`;
    match = line.match(/(\s+)expect\((.*)\).toBe\((.*)\)/)
    if (match)
      line = `${match[1]}assert ${match[2]} == ${match[3]}`;

    line = line.replace(/ false/g, ' False');
    line = line.replace(/ true/g, ' True');
  
    line = line.replace(/ == null/g, ' == None');
    if (line.trim().startsWith('assert') && line.endsWith(' == True'))
      line = line.substring(0, line.length - ' == True'.length);

    // Quote evaluate
    let index = line.indexOf('.evaluate(');
    if (index !== -1) {
      const tokens = [line.substring(0, index) + '.evaluate(\''];
      let depth = 0;
      for (let i = index + '.evaluate('.length; i < line.length; ++i) {
        if (line[i] == '(')
          ++depth;
        if (line[i] == ')')
          --depth;
        if (depth < 0) {
          tokens.push('\'' + line.substring(i));
          break;
        }
        if (depth === 0 && line[i] === ',') {
          tokens.push('\"' + line.substring(i));
          break;
        }
        tokens.push(line[i]);
      }
      console.log(tokens.join(''));
      continue;
    }

    // Name keys in the dict
    index = line.indexOf('{');
    if (index !== -1) {
      let ok = false;
      for (let i = index + 1; i < line.length; ++i) {
        if (line[i] === '}') {
          try {
            console.log(line.substring(0, index) + JSON.stringify(eval('(' + line.substring(index, i + 1) + ')')).replace(/\"/g, '\'') + line.substring(i + 1));
            ok = true;
            break;
          } catch (e) {
          }
        }
      }
      if (ok) continue;
    }

    // Single line template strings
    index = line.indexOf('`');
    if (index !== -1) {
      const tokens = [line.substring(0, index) + '\''];
      let ok = false; 
      for (let i = index + 1; i < line.length; ++i) {
        if (line[i] === '`') {
          tokens.push('\'' + line.substring(i + 1));
          console.log(tokens.join(''));
          ok = true;
          break;
        }
        if (line[i] === '\'')
          tokens.push('"');
        else
          tokens.push(line[i]);
      }
      if (ok) continue;
    }
    
    console.log(line);
  }
})();
