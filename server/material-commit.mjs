const key = (o) => `${o.controller}:${o.location}:${o.sequence}:${o.position || 0}:${o.code || 0}`;
const equal = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));
// Fixed-count fusion/link scripts may continue immediately after the last toggle.
// Receive the whole approved draft first, then follow the core's changing indices.
export class MaterialCommit {
  active = false;
  queue = [];
  approved = new Set();
  expected = null;
  notice = '';
  begin(prompt, input) {
    if (!Array.isArray(input.materialIds)) return input;
    if (input.promptId !== prompt.id) throw new Error('操作已过期，请按当前提示操作');
    if (prompt.kind !== 'unselect') throw new Error('当前不是素材选择');
    const ids = input.materialIds;
    if (
      new Set(ids).size !== ids.length ||
      !ids.every((id) => prompt.options.some((o) => o.id === id))
    )
      throw new Error('素材选项无效');
    this.notice = '';
    this.active = true;
    this.expected = null;
    this.approved = new Set(prompt.options.filter((o) => o.selected).map(key));
    this.queue = ids.map((id) => key(prompt.options.find((o) => o.id === id)));
    for (const k of this.queue) {
      if (this.approved.has(k)) this.approved.delete(k);
      else this.approved.add(k);
    }
    return this.next(prompt);
  }
  next(prompt) {
    if (!this.active) return null;
    if (prompt.kind !== 'unselect') {
      this.stop();
      return null;
    }
    const actual = new Set(prompt.options.filter((o) => o.selected).map(key));
    if (this.expected && !equal(actual, this.expected)) return this.changed();
    if (this.queue.length) {
      const k = this.queue.shift(),
        option = prompt.options.find((o) => key(o) === k);
      if (!option) return this.changed();
      this.expected = new Set(actual);
      if (this.expected.has(k)) this.expected.delete(k);
      else this.expected.add(k);
      return { promptId: prompt.id, ids: [option.id] };
    }
    const finish = equal(actual, this.approved) && prompt.canFinish;
    this.stop();
    if (finish) return { promptId: prompt.id, finish: true };
    this.notice = '请根据当前素材条件继续选择，再确认素材';
    return null;
  }
  changed() {
    this.stop();
    this.notice = '素材条件已更新，请调整选择后重新确认';
    return null;
  }
  stop() {
    this.active = false;
    this.queue = [];
    this.expected = null;
  }
  takeNotice() {
    const message = this.notice;
    this.notice = '';
    return message;
  }
}
