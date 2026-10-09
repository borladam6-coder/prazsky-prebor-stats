// Who is editing. There are no accounts: the history shows a nickname the person
// types once, plus an anonymous random device id (hashed in the database).

const NICK_KEY = 'pps.nickname';
const DEVICE_KEY = 'pps.device';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: keep it in memory only */
  }
}

class Identity {
  nickname = $state<string | null>(read(NICK_KEY));
  readonly device: string;

  /** Set while the nickname dialog is open; resolved when the person saves it. */
  request = $state<{ resolve: (name: string | null) => void } | null>(null);

  constructor() {
    let id = read(DEVICE_KEY);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      write(DEVICE_KEY, id);
    }
    this.device = id;
  }

  setNickname(name: string) {
    const clean = name.replace(/\s+/g, ' ').trim();
    this.nickname = clean;
    write(NICK_KEY, clean);
  }

  /** Returns the nickname, asking for it first if needed. null = the person cancelled. */
  async require(): Promise<string | null> {
    if (this.nickname) return this.nickname;
    return new Promise((resolve) => {
      this.request = { resolve };
    });
  }
}

export const identity = new Identity();
