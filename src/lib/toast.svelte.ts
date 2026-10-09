export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

class Toasts {
  list = $state<Toast[]>([]);
  private next = 1;

  show(text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) {
    const id = this.next++;
    this.list = [...this.list.slice(-2), { id, kind, text, action }];
    setTimeout(() => this.dismiss(id), kind === 'error' ? 7000 : action ? 6000 : 3000);
  }

  dismiss(id: number) {
    this.list = this.list.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
