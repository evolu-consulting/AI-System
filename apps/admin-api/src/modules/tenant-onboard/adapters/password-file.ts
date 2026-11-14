// CR-159 · file mật khẩu tạm của `--pw-out`: `email<TAB>mật khẩu`, quyền 600, ghi nối ngay khi sinh; `probe` thử ghi/xoá một file
// cạnh đó để thư mục không ghi được thì dừng TRƯỚC khi ghi DB.
import { appendFile, chmod, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function passwordFile(path: string) {
  return {
    save: async (email: string, password: string): Promise<void> => {
      await appendFile(path, `${email}\t${password}\n`, { mode: 0o600 });
      await chmod(path, 0o600);
    },
    probe: async (): Promise<void> => {
      const t = join(dirname(path), `.pw-probe-${process.pid}-${Date.now()}`);
      await writeFile(t, "", { mode: 0o600 });
      await unlink(t);
    },
  };
}
