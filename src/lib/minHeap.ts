/** Binary min-heap over integer indices keyed on a number priority. */
export class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(index: number, priority: number): void {
    this.idx.push(index);
    this.pri.push(priority);
    let i = this.idx.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { index: number; priority: number } {
    const top = { index: this.idx[0], priority: this.pri[0] };
    const lastIdx = this.idx.pop() as number;
    const lastPri = this.pri.pop() as number;
    if (this.idx.length > 0) {
      this.idx[0] = lastIdx;
      this.pri[0] = lastPri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.pri.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.pri.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b], this.idx[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}
