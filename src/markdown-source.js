/**
 * Markdown source operations: structural token ranges and task-checkbox mutation.
 */

function isEscapedSourceToken(line, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function getMarkdownSourceTokenRanges(line) {
  const sourceLine = typeof line === 'string' ? line : '';
  const ranges = [];
  const codeIntervals = [];
  const addRange = (start, end) => {
    if (start >= 0 && end > start) ranges.push({ start, end });
  };

  const fence = sourceLine.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (fence) {
    const start = sourceLine.indexOf(fence[1]);
    addRange(start, start + fence[1].length);
  } else {
    const structuralPatterns = [
      /^\s{0,3}(#{1,6})(?=\s|$)/,
      /^\s{0,3}(>)/,
      /^\s*([-+*])(?=\s)/,
      /^\s*(\d+[.)])(?=\s)/,
    ];
    for (const pattern of structuralPatterns) {
      const match = sourceLine.match(pattern);
      if (!match) continue;
      const start = sourceLine.indexOf(match[1]);
      addRange(start, start + match[1].length);
      break;
    }

    const taskMarker = sourceLine.match(/^\s*(?:[-+*]|\d+[.)])\s+(\[[ xX]\])/);
    if (taskMarker) {
      const start = sourceLine.indexOf(taskMarker[1]);
      addRange(start, start + taskMarker[1].length);
    }
  }

  const backtickPattern = /`+/g;
  let backtickMatch;
  while ((backtickMatch = backtickPattern.exec(sourceLine)) !== null) {
    if (isEscapedSourceToken(sourceLine, backtickMatch.index)) continue;
    const delimiter = backtickMatch[0];
    const closingIndex = sourceLine.indexOf(delimiter, backtickMatch.index + delimiter.length);
    addRange(backtickMatch.index, backtickMatch.index + delimiter.length);
    if (closingIndex < 0) continue;
    addRange(closingIndex, closingIndex + delimiter.length);
    codeIntervals.push([backtickMatch.index, closingIndex + delimiter.length]);
    backtickPattern.lastIndex = closingIndex + delimiter.length;
  }

  const isInsideCode = (index) => codeIntervals.some(([start, end]) => index > start && index < end);
  const emphasisPattern = /\*\*|__|~~|\*|_/g;
  const delimiterPositions = new Map();
  let emphasisMatch;
  while ((emphasisMatch = emphasisPattern.exec(sourceLine)) !== null) {
    const token = emphasisMatch[0];
    const index = emphasisMatch.index;
    if (isEscapedSourceToken(sourceLine, index) || isInsideCode(index)) continue;
    if (
      token === '_'
      && /[\p{L}\p{N}]/u.test(sourceLine[index - 1] || '')
      && /[\p{L}\p{N}]/u.test(sourceLine[index + 1] || '')
    ) {
      continue;
    }
    const positions = delimiterPositions.get(token) || [];
    positions.push(index);
    delimiterPositions.set(token, positions);
  }
  for (const [token, positions] of delimiterPositions) {
    for (let index = 0; index + 1 < positions.length; index += 2) {
      addRange(positions[index], positions[index] + token.length);
      addRange(positions[index + 1], positions[index + 1] + token.length);
    }
  }

  const linkPattern = /(!?)\[[^\]\n]*\]\([^\)\n]*\)/g;
  let linkMatch;
  while ((linkMatch = linkPattern.exec(sourceLine)) !== null) {
    if (isEscapedSourceToken(sourceLine, linkMatch.index) || isInsideCode(linkMatch.index)) continue;
    const openLength = linkMatch[1] ? 2 : 1;
    const bridgeIndex = sourceLine.indexOf('](', linkMatch.index + openLength);
    const closeIndex = linkMatch.index + linkMatch[0].length - 1;
    addRange(linkMatch.index, linkMatch.index + openLength);
    addRange(bridgeIndex, bridgeIndex + 2);
    addRange(closeIndex, closeIndex + 1);
  }

  const visibleRanges = [];
  for (const range of ranges.sort((left, right) => left.start - right.start || right.end - left.end)) {
    const previous = visibleRanges.at(-1);
    if (!previous || range.start >= previous.end) visibleRanges.push(range);
  }
  return visibleRanges;
}

export function setMarkdownTaskChecked(source, sourceLine, checked) {
  if (typeof source !== 'string') return null;
  const lineNumber = Math.floor(Number(sourceLine));
  if (!Number.isFinite(lineNumber) || lineNumber < 1) return null;

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const index = lineNumber - 1;
  if (index >= lines.length) return null;

  const match = lines[index].match(/^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\])/);
  if (!match) return null;
  const nextMarker = checked ? 'x' : ' ';
  const nextLine = `${match[1]}${nextMarker}${match[3]}${lines[index].slice(match[0].length)}`;
  if (nextLine === lines[index]) return { source, changed: false };

  lines[index] = nextLine;
  return { source: lines.join(newline), changed: true };
}
