/** Solves A x = b by Gaussian elimination with partial pivoting. Throws if singular. */
export function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-10) throw new Error('singular matrix');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let c = i + 1; c < n; c++) s -= m[i][c] * x[c];
    x[i] = s / m[i][i];
  }
  return x;
}

/** Ordinary least squares via the normal equations. Rows already include any intercept column. */
export function fitLeastSquares(rows: number[][], targets: number[]): number[] {
  if (rows.length === 0) throw new Error('no rows');
  const k = rows[0].length;
  if (rows.length < k) throw new Error('fewer rows than parameters');
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  rows.forEach((row, i) => {
    for (let a = 0; a < k; a++) {
      xty[a] += row[a] * targets[i];
      for (let c = 0; c < k; c++) xtx[a][c] += row[a] * row[c];
    }
  });
  return solveLinearSystem(xtx, xty);
}
