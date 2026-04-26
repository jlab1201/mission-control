import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { expandTilde, assertPathInHome } from '../../src/server/workspace/pathGuard';

describe('expandTilde', () => {
  const home = os.homedir();

  it('expands a bare ~', () => {
    expect(expandTilde('~')).toBe(home);
  });

  it('expands a ~/ prefix', () => {
    expect(expandTilde('~/.mission-control/config.json')).toBe(
      path.join(home, '.mission-control/config.json'),
    );
  });

  it('leaves absolute paths unchanged', () => {
    expect(expandTilde('/etc/passwd')).toBe('/etc/passwd');
    expect(expandTilde(path.join(home, 'projects'))).toBe(path.join(home, 'projects'));
  });

  it('does not touch a non-prefix tilde', () => {
    expect(expandTilde('/tmp/~/file')).toBe('/tmp/~/file');
    expect(expandTilde('~user/file')).toBe('~user/file');
  });
});

describe('assertPathInHome', () => {
  const home = os.homedir();

  it('accepts paths inside home', () => {
    expect(assertPathInHome(path.join(home, 'projects/foo'))).toBe(
      path.join(home, 'projects/foo'),
    );
  });

  it('accepts ~/ paths and returns the expanded form', () => {
    expect(assertPathInHome('~/projects/foo')).toBe(path.join(home, 'projects/foo'));
  });

  it('rejects paths outside home', () => {
    expect(() => assertPathInHome('/etc/passwd')).toThrow(/outside the home directory/);
  });

  it('rejects path-traversal escapes from inside home', () => {
    expect(() => assertPathInHome(path.join(home, '../etc/passwd'))).toThrow(
      /outside the home directory/,
    );
  });
});
