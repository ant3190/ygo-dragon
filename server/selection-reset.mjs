// SELECT_UNSELECT_CARD updates the legal candidates after every material change.
// Undo through those updates; never guess indices from an earlier prompt.
export class SelectionReset {
  active = false;
  cancelWhenEmpty = false;
  previousCount = null;
  notice = '';
  begin(prompt, input) {
    if (!input.clear) return input;
    if (input.promptId !== prompt.id) throw new Error('操作已过期，请按当前提示操作');
    if (prompt.kind !== 'unselect') throw new Error('当前操作不能重选素材');
    this.active = true;
    this.previousCount = null;
    this.notice = '';
    this.cancelWhenEmpty = !!input.cancelAll;
    return this.next(prompt);
  }
  next(prompt) {
    if (!this.active) return null;
    if (prompt.kind === 'unselect') {
      const selected = prompt.options.filter((o) => o.selected);
      if (this.previousCount !== null && selected.length >= this.previousCount) {
        this.stop();
        this.notice = '该素材由规则指定，无法撤回，请调整其他素材';
        return null;
      }
      const option = selected[0];
      if (option) {
        this.previousCount = selected.length;
        return { promptId: prompt.id, ids: [option.id] };
      }
      const cancel = this.cancelWhenEmpty && prompt.canCancel;
      this.stop();
      return cancel ? { promptId: prompt.id, cancel: true } : null;
    }
    this.stop();
    return null;
  }
  stop() {
    this.active = false;
    this.cancelWhenEmpty = false;
    this.previousCount = null;
  }
  takeNotice() {
    const message = this.notice;
    this.notice = '';
    return message;
  }
}
