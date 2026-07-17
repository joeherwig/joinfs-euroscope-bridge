'use strict';

const { spawn } = require('child_process');

const SW_MINIMIZE = 6;

// Sets this process's console window title and minimizes it to the taskbar.
// Shells out to Windows' built-in PowerShell to call kernel32/user32 via
// inline P/Invoke - deliberately not a bundled native addon or helper
// binary, so the packaged app stays a single self-contained .exe. The
// spawned powershell process inherits our existing console rather than
// creating a new one, so GetConsoleWindow() inside it resolves to the same
// window we're running in.
//
// Without an explicit title, Windows shows this window in the taskbar under
// the console host's own description (e.g. "Console Window and PTY Host")
// since the packaged exe is just a renamed copy of node.exe.
function configureConsoleWindow(title, logger) {
  if (process.platform !== 'win32') {
    return;
  }

  const script = [
    "Add-Type -Name Win -Namespace Native -MemberDefinition '",
    '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();',
    '[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetConsoleTitleW(string title);',
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    "';",
    `[Native.Win]::SetConsoleTitleW(${JSON.stringify(title)}) | Out-Null;`,
    '$h = [Native.Win]::GetConsoleWindow();',
    `if ($h -ne [IntPtr]::Zero) { [Native.Win]::ShowWindow($h, ${SW_MINIMIZE}) | Out-Null }`,
  ].join(' ');

  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
  });

  child.on('error', (err) => {
    if (logger) {
      logger.warn(`Could not configure console window: ${err.message}`);
    }
  });
}

module.exports = { configureConsoleWindow };
