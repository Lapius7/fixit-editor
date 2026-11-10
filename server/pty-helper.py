# 疑似端末(pty)で対話シェルを動かす。標準入出力が端末の入出力、fd 3 が「列 行」のサイズ通知
import fcntl, os, pty, select, signal, struct, sys, termios

cwd = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~")
shell = os.environ.get("SHELL", "/bin/bash")
# `-- コマンド 引数...` があれば、シェルの代わりにそれを動かす(SSH 先のシェルなど)
argv = sys.argv[3:] if len(sys.argv) > 2 and sys.argv[2] == "--" else [shell]
pid, fd = pty.fork()
if pid == 0:
    try:
        os.chdir(cwd)
    except OSError:
        pass
    # zsh の設定が末尾で `cd ~` していても、指定したフォルダを保つ(~/.zshrc の ZSH_RELOAD の合図)
    if os.environ.get("FIXIT_KEEP_CWD"):
        os.environ["ZSH_RELOAD"] = "1"
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    os.execvp(argv[0], argv)

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

buf = b""
try:
    while True:
        ready, _, _ = select.select([0, fd, 3], [], [])
        if 0 in ready:
            d = os.read(0, 65536)
            if not d:
                break
            os.write(fd, d)
        if fd in ready:
            d = os.read(fd, 65536)
            if not d:
                break
            os.write(1, d)
        if 3 in ready:
            d = os.read(3, 4096)
            if not d:
                break
            buf += d
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                try:
                    c, r = line.split()
                    resize(int(c), int(r))
                except ValueError:
                    pass
except OSError:
    pass
finally:
    try:
        os.kill(pid, signal.SIGHUP)
    except OSError:
        pass
