import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function fileHash(name, data) {
  const bytes = /\.(md|html|svg)$/i.test(name) ? data.toString('utf8').replace(/\r\n/g, '\n') : data;
  return createHash('sha256').update(bytes).digest('hex');
}

export function safeFile(root, relative, { missing = false } = {}) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || /[\u0000-\u001f\u007f]/.test(relative) || relative.split('/').some((s) => !s || s === '.' || s === '..' || s.toLowerCase() === '.git')) throw new Error('허용하지 않는 파일 경로입니다.');
  let current = fs.realpathSync(root);
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`심볼릭 링크는 허용하지 않습니다: ${relative}`);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (fs.existsSync(current)) {
    if (!fs.statSync(current).isFile()) throw new Error(`일반 파일이 아닙니다: ${relative}`);
  } else if (!missing) throw new Error(`파일이 없습니다: ${relative}`);
  return current;
}
