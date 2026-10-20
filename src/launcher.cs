// DSH-Pet launcher / guardian
// - 双击启动：拉起内置 Electron（ELECTRON_RUN_AS_NODE=1）跑 dsh-pet 独立模式，然后本进程常驻做“看门”
// - 看门：前台出现全屏应用（游戏/全屏视频/演示）时把桌宠窗口隐藏，退出全屏再恢复
// - 再次双击：询问是否退出桌宠
// - 参数：/stop 退出桌宠；/install-autostart 注册开机自启；/uninstall-autostart 取消开机自启
// - 配置：同目录 guard.ini（可选）
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    private const string AppTitle = "DSH 桌宠";
    private const string ShortMutexName = "Local\\DSH-Pet-Launcher-9c1f";
    private const string GuardianMutexName = "Local\\DSH-Pet-Guardian-9c1f";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "DSH-Pet";

    private const int SW_HIDE = 0;
    private const int SW_SHOWNA = 8;
    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const int DWMWA_CLOAKED = 14;

    // ------------------------------------------------------------------ 路径

    private static string BaseDir()
    {
        return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    }

    private static string ElectronPath()
    {
        return Path.Combine(Path.Combine(Path.Combine(BaseDir(), "runtime"), "electron"), "electron.exe");
    }

    private static string StandalonePath()
    {
        return Path.Combine(Path.Combine(Path.Combine(BaseDir(), "app"), "lib"), "standalone.js");
    }

    private static string DshElectronPath()
    {
        return Path.Combine(Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh"), "electron"), "electron.exe");
    }

    private static string ConfigPath()
    {
        return Path.Combine(BaseDir(), "guard.ini");
    }

    private static string LogPath()
    {
        return Path.Combine(BaseDir(), "guard.log");
    }

    // ------------------------------------------------------------------ 配置

    private sealed class GuardConfig
    {
        public bool HideOnFullscreen = true;
        public bool AlsoHideDshPet = true;
        public bool HideDshPetAlways = true;
        public bool TakeoverNotifications = false; // 已移除系统通知接管：固定不接管
        public int PollMs = 500;
        public bool WriteLog = true;
    }

    private static GuardConfig LoadConfig()
    {
        GuardConfig cfg = new GuardConfig();
        try
        {
            if (!File.Exists(ConfigPath())) return cfg;
            foreach (string rawLine in File.ReadAllLines(ConfigPath()))
            {
                string line = rawLine.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("#") || line.StartsWith(";") || line.StartsWith("//")) continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string key = line.Substring(0, eq).Trim().ToLowerInvariant();
                string val = line.Substring(eq + 1).Trim().ToLowerInvariant();
                bool on = (val == "1" || val == "true" || val == "yes" || val == "on");
                if (key == "hide_on_fullscreen") cfg.HideOnFullscreen = on;
                else if (key == "also_hide_dsh_pet") cfg.AlsoHideDshPet = on;
                else if (key == "hide_dsh_pet_always") cfg.HideDshPetAlways = on;
                else if (key == "takeover_notifications") { /* 已移除：忽略该项 */ }
                else if (key == "log") cfg.WriteLog = on;
                else if (key == "poll_ms")
                {
                    int ms;
                    if (int.TryParse(val, out ms) && ms >= 200 && ms <= 5000) cfg.PollMs = ms;
                }
            }
        }
        catch (Exception)
        {
        }
        return cfg;
    }

    private static void Log(GuardConfig cfg, string message)
    {
        if (cfg == null || !cfg.WriteLog) return;
        try
        {
            FileInfo fi = new FileInfo(LogPath());
            if (fi.Exists && fi.Length > 256 * 1024) fi.Delete();
            File.AppendAllText(LogPath(), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine, Encoding.UTF8);
        }
        catch (Exception)
        {
        }
    }

    // ------------------------------------------------------------------ 进程查找

    private static List<int> FindRunningHosts()
    {
        List<int> pids = new List<int>();
        string target = StandalonePath();
        try
        {
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='electron.exe'"))
            {
                foreach (ManagementObject mo in searcher.Get())
                {
                    object raw = mo["CommandLine"];
                    string cmd = raw == null ? null : Convert.ToString(raw);
                    if (cmd != null && cmd.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        pids.Add(Convert.ToInt32(mo["ProcessId"]));
                    }
                }
            }
        }
        catch (Exception)
        {
        }
        return pids;
    }

    private static void KillTree(int pid)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process p = Process.Start(psi);
            if (p != null) p.WaitForExit(5000);
        }
        catch (Exception)
        {
        }
    }

    private static bool StopPet()
    {
        List<int> pids = FindRunningHosts();
        if (pids.Count == 0) return false;
        foreach (int pid in pids) KillTree(pid);
        return true;
    }

    private static Process StartPet()
    {
        string electron = ElectronPath();
        string script = StandalonePath();
        if (!File.Exists(electron))
        {
            MessageBox.Show("找不到内置的 Electron 运行时：\r\n" + electron + "\r\n\r\n请重新解压完整的 DSH-Pet 压缩包。",
                AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return null;
        }
        if (!File.Exists(script))
        {
            MessageBox.Show("找不到桌宠主程序：\r\n" + script,
                AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return null;
        }

        ProcessStartInfo psi = new ProcessStartInfo(electron);
        psi.Arguments = "\"" + script + "\"";
        psi.WorkingDirectory = Path.GetDirectoryName(electron);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        psi.EnvironmentVariables["DSH_PET_ELECTRON_PATH"] = electron;
        return Process.Start(psi);
    }

    // ------------------------------------------------------------------ 开机自启

    private static bool AutostartInstalled()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
            {
                if (key == null) return false;
                object v = key.GetValue(RunValueName);
                return v != null && Convert.ToString(v).Length > 0;
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void InstallAutostart()
    {
        string exe = Path.Combine(BaseDir(), "DSH-Pet.exe");
        string command = "\"" + exe + "\" --autostart";
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKeyPath))
        {
            key.SetValue(RunValueName, command, RegistryValueKind.String);
        }
    }

    private static void UninstallAutostart()
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true))
        {
            if (key != null) key.DeleteValue(RunValueName, false);
        }
    }

    // ------------------------------------------------------------------ 首次运行自动配置

    private static string FlagPath()
    {
        return Path.Combine(BaseDir(), "installed.flag");
    }

    private const string DefaultGuardIni =
        "# DSH 桌宠 看门进程配置（改完重启桌宠生效）\r\n" +
        "# 1=开启 0=关闭\r\n" +
        "\r\n" +
        "# 前台出现全屏应用（游戏/全屏视频/演示）时自动隐藏桌宠\r\n" +
        "hide_on_fullscreen=1\r\n" +
        "\r\n" +
        "# 同时隐藏 DSH 自带的桌宠窗口（避免两只叠在一起）\r\n" +
        "also_hide_dsh_pet=1\r\n" +
        "\r\n" +
        "# 桌宠运行期间始终隐藏 DSH 自带的桌宠窗口（退出桌宠后恢复）\r\n" +
        "hide_dsh_pet_always=1\r\n" +
        "\r\n" +
        "# 桌宠运行期间接管系统通知：关闭 Windows 原生通知弹窗（退出后自动恢复原设置）\r\n" +
        "takeover_notifications=1\r\n" +
        "\r\n" +
        "# 看门轮询间隔（毫秒，200-5000）\r\n" +
        "poll_ms=500\r\n" +
        "\r\n" +
        "# 是否写 guard.log\r\n" +
        "log=1\r\n";

    private static void EnsureFirstRun(GuardConfig cfg)
    {
        try
        {
            if (!File.Exists(ConfigPath()))
            {
                File.WriteAllText(ConfigPath(), DefaultGuardIni, Encoding.UTF8);
                Log(cfg, "first run: guard.ini created with defaults");
            }
            if (!File.Exists(FlagPath()))
            {
                InstallAutostart();
                File.WriteAllText(FlagPath(), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " first run setup\r\n", Encoding.UTF8);
                Log(cfg, "first run: autostart registered");
            }
        }
        catch (Exception ex)
        {
            Log(cfg, "first run setup failed: " + ex.Message);
        }
    }

    // ------------------------------------------------------------------ 系统通知接管

    private const string NotifyKeyPath = @"Software\Microsoft\Windows\CurrentVersion\PushNotifications";
    private const string NotifyValueName = "ToastEnabled";
    // Win10 1809+/Win11 的「通知」总开关（设置 → 系统 → 通知 里的总闸）
    private const string NotifySettingsKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
    private const string NotifyGlobalValueName = "NOC_GLOBAL_SETTING_TOASTS_ENABLED";

    private static string NotifyStatePath()
    {
        return Path.Combine(BaseDir(), "notify.state");
    }

    private static string ReadRegValue(string keyPath, string name)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(keyPath, false))
            {
                if (key == null) return "absent";
                object v = key.GetValue(name);
                return v == null ? "absent" : Convert.ToString(Convert.ToInt32(v));
            }
        }
        catch (Exception)
        {
            return "absent";
        }
    }

    private static void WriteRegValue(string keyPath, string name, string state, GuardConfig cfg)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
        {
            if (state == "absent" || state.Length == 0)
            {
                key.DeleteValue(name, false);
            }
            else
            {
                int v;
                if (!int.TryParse(state, out v)) v = 1;
                key.SetValue(name, v, RegistryValueKind.DWord);
            }
        }
    }

    /// <summary>把 Windows 原生通知开关恢复成桌宠启动前的样子。</summary>
    private static void RestoreNotifications(GuardConfig cfg)
    {
        try
        {
            if (!File.Exists(NotifyStatePath())) return;
            string[] lines = File.ReadAllLines(NotifyStatePath(), Encoding.UTF8);
            string toast = "";
            string global = "";
            foreach (string line in lines)
            {
                string t = line.Trim();
                if (t.StartsWith("toast=")) toast = t.Substring(6);
                else if (t.StartsWith("global=")) global = t.Substring(7);
                else if (t.Length > 0 && toast.Length == 0) toast = t; // 兼容旧版单值格式
            }
            if (toast.Length == 0) toast = "absent";
            if (global.Length == 0) global = "absent";
            WriteRegValue(NotifyKeyPath, NotifyValueName, toast, cfg);
            WriteRegValue(NotifySettingsKeyPath, NotifyGlobalValueName, global, cfg);
            File.Delete(NotifyStatePath());
            Log(cfg, "notifications restored (toast=" + toast + ", global=" + global + ")");
            RestartWpnUserService(cfg);
        }
        catch (Exception ex)
        {
            Log(cfg, "restore notifications failed: " + ex.Message);
        }
    }

        private const string DshToastFallback = "electron.app.DeepSeek Harness";

        private static string DshNotifyStatePath()
        {
            return Path.Combine(BaseDir(), "dshnotify.state");
        }

        private static string FindDshToastId()
        {
            try
            {
                using (RegistryKey root = Registry.CurrentUser.OpenSubKey(NotifySettingsKeyPath, false))
                {
                    if (root != null)
                    {
                        foreach (string n in root.GetSubKeyNames())
                        {
                            if (n.IndexOf("DeepSeek Harness", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                n.IndexOf("deepseek", StringComparison.OrdinalIgnoreCase) >= 0)
                                return n;
                        }
                    }
                }
            }
            catch (Exception)
            {
            }
            return DshToastFallback;
        }

        private static void MuteDshToast(GuardConfig cfg)
        {
            try
            {
                string id = FindDshToastId();
                string keyPath = NotifySettingsKeyPath + "\\" + id;
                string prev = ReadRegValue(keyPath, "Enabled");
                File.WriteAllText(DshNotifyStatePath(), id + "\r\n" + prev + "\r\n", Encoding.UTF8);
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(keyPath))
                {
                    k.SetValue("Enabled", 0, RegistryValueKind.DWord);
                }
                Log(cfg, "dsh toast muted (" + id + ", previous=" + prev + ")");
            }
            catch (Exception ex)
            {
                Log(cfg, "mute dsh toast failed: " + ex.Message);
            }
        }

        private static void RestoreDshToast(GuardConfig cfg)
        {
            try
            {
                string p = DshNotifyStatePath();
                if (!File.Exists(p)) return;
                string[] st = File.ReadAllLines(p, Encoding.UTF8);
                if (st.Length < 2)
                {
                    File.Delete(p);
                    return;
                }
                string id = st[0].Trim();
                string prev = st[1].Trim();
                string keyPath = NotifySettingsKeyPath + "\\" + id;
                WriteRegValue(keyPath, "Enabled", prev.Length == 0 ? "absent" : prev, cfg);
                File.Delete(p);
                Log(cfg, "dsh toast restored (" + id + ", previous=" + (prev.Length == 0 ? "absent" : prev) + ")");
            }
            catch (Exception ex)
            {
                Log(cfg, "restore dsh toast failed: " + ex.Message);
            }
        }

    /// <summary>关闭 Windows 原生通知弹窗（先备份原值，退出时由 RestoreNotifications 还原）。</summary>
    private static void SuppressNotifications(GuardConfig cfg)
    {
        if (cfg == null || !cfg.TakeoverNotifications) return;
        try
        {
            // 上次异常退出没恢复 → 先恢复再重新接管，避免备份值被覆盖成 0
            if (File.Exists(NotifyStatePath())) RestoreNotifications(cfg);

            string toast = ReadRegValue(NotifyKeyPath, NotifyValueName);
            string global = ReadRegValue(NotifySettingsKeyPath, NotifyGlobalValueName);
            File.WriteAllText(NotifyStatePath(), "toast=" + toast + "\r\nglobal=" + global + "\r\n", Encoding.UTF8);
            WriteRegValue(NotifyKeyPath, NotifyValueName, "0", cfg);
            WriteRegValue(NotifySettingsKeyPath, NotifyGlobalValueName, "0", cfg);
            Log(cfg, "notifications suppressed (toast=" + toast + ", global=" + global + ")");
            RestartWpnUserService(cfg);
        }
        catch (Exception ex)
        {
            Log(cfg, "suppress notifications failed: " + ex.Message);
        }
    }

    /// <summary>
    /// 重启「Windows 推送通知用户服务」。
    /// 只改注册表的话系统仍在内存里用旧的开关值（弹窗照旧出现），必须重启这个服务才会重新读取。
    /// </summary>
    private static void RestartWpnUserService(GuardConfig cfg)
    {
        int done = 0;
        try
        {
            ServiceController[] all = ServiceController.GetServices();
            foreach (ServiceController sc in all)
            {
                if (sc.ServiceName.StartsWith("WpnUserService", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        if (sc.Status != ServiceControllerStatus.Stopped)
                        {
                            sc.Stop();
                            sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(10));
                        }
                        sc.Start();
                        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(10));
                        done++;
                    }
                    catch (Exception ex)
                    {
                        Log(cfg, "restart " + sc.ServiceName + " failed: " + ex.Message);
                    }
                    finally
                    {
                        sc.Dispose();
                    }
                }
                else
                {
                    sc.Dispose();
                }
            }
            Log(cfg, "push service restarted (" + done + " service(s))");
        }
        catch (Exception ex)
        {
            Log(cfg, "restart push service failed: " + ex.Message);
        }
    }

    // ------------------------------------------------------------------ Win32

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint flags, StringBuilder exeName, ref int size);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr h);

    private static string ClassNameOf(IntPtr hwnd)
    {
        StringBuilder sb = new StringBuilder(256);
        int n = GetClassName(hwnd, sb, sb.Capacity);
        return n > 0 ? sb.ToString() : string.Empty;
    }

    private static string TitleOf(IntPtr hwnd)
    {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(hwnd, sb, sb.Capacity);
        string t = sb.ToString();
        if (t.Length > 60) t = t.Substring(0, 60);
        return t;
    }

    private static readonly Dictionary<uint, string> ImagePathCache = new Dictionary<uint, string>();

    private static string ImagePathOf(uint pid)
    {
        string cached;
        if (ImagePathCache.TryGetValue(pid, out cached)) return cached;
        string result = null;
        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h != IntPtr.Zero)
        {
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (QueryFullProcessImageName(h, 0, sb, ref size)) result = sb.ToString();
            }
            finally
            {
                CloseHandle(h);
            }
        }
        ImagePathCache[pid] = result;
        return result;
    }

    private static bool IsOurElectron(uint pid, GuardConfig cfg)
    {
        string path = ImagePathOf(pid);
        if (path == null) return false;
        if (string.Equals(path, ElectronPath(), StringComparison.OrdinalIgnoreCase)) return true;
        if (cfg != null && (cfg.AlsoHideDshPet || cfg.HideDshPetAlways) && string.Equals(path, DshElectronPath(), StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static bool IsOwnPetWindow(IntPtr hwnd)
    {
        if (ClassNameOf(hwnd) != "Chrome_WidgetWin_1") return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        string path = ImagePathOf(pid);
        return path != null && string.Equals(path, ElectronPath(), StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsDshPetWindow(IntPtr hwnd)
    {
        if (ClassNameOf(hwnd) != "Chrome_WidgetWin_1") return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        string path = ImagePathOf(pid);
        return path != null && string.Equals(path, DshElectronPath(), StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPetWindow(IntPtr hwnd, GuardConfig cfg)
    {
        if (ClassNameOf(hwnd) != "Chrome_WidgetWin_1") return false;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return IsOurElectron(pid, cfg);
    }

    /// <summary>当前前台窗口是否是一个覆盖整块显示器的窗口（全屏游戏/全屏视频/演示）。</summary>
    private static bool IsForegroundFullscreen(GuardConfig cfg)
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        if (!IsWindowVisible(fg)) return false;
        if (IsIconic(fg)) return false;
        if (IsPetWindow(fg, cfg)) return false;

        // 桌面 / 任务栏不是全屏应用
        string cls = ClassNameOf(fg);
        if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return false;

        // 被 DWM 遮蔽（虚拟桌面/最小化动画）不算
        int cloaked = 0;
        try
        {
            DwmGetWindowAttribute(fg, DWMWA_CLOAKED, out cloaked, sizeof(int));
        }
        catch (Exception)
        {
            cloaked = 0;
        }
        if (cloaked != 0) return false;

        RECT r;
        if (!GetWindowRect(fg, out r)) return false;
        if (r.Right - r.Left <= 0 || r.Bottom - r.Top <= 0) return false;

        IntPtr mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(mon, ref mi)) return false;

        const int tol = 3;
        bool coversMonitor =
            r.Left <= mi.rcMonitor.Left + tol &&
            r.Top <= mi.rcMonitor.Top + tol &&
            r.Right >= mi.rcMonitor.Right - tol &&
            r.Bottom >= mi.rcMonitor.Bottom - tol;
        if (!coversMonitor) return false;

        uint pid;
        GetWindowThreadProcessId(fg, out pid);
        string exe = ImagePathOf(pid);
        string exeName = exe == null ? string.Empty : Path.GetFileName(exe).ToLowerInvariant();
        // 资源管理器自己的“全屏”多半是桌面/文件列表，不算全屏任务
        if (exeName == "explorer.exe") return false;
        // 我们自己的程序窗口不算
        if (exeName == "dsh-pet.exe") return false;

        return true;
    }

    private static List<IntPtr> EnumPetWindows(GuardConfig cfg)
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            if (IsPetWindow(hwnd, cfg)) found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static List<IntPtr> EnumOwnPetWindows()
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            if (IsOwnPetWindow(hwnd)) found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // 桌宠窗口如果跑到屏幕外（只剩很少一部分可见），就把它拉回主屏右下角。
    // 这一步放在宿主进程做：这里的坐标是物理像素，不受 Electron 的 DPI 换算影响。
    private static bool onScreenNoWinLogged = false;
    private static bool mouseMovedLogged = false;

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    // 左键按下时不介入窗口位置
    private static bool IsMouseButtonDown()
    {
        return (GetAsyncKeyState(0x01) & 0x8000) != 0;
    }

    private static void EnsureOnScreen(GuardConfig cfg)
    {
        List<IntPtr> pets = EnumOwnPetWindows();
        if (pets.Count == 0) return;
        IntPtr mon = MonitorFromWindow(pets[0], MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(mon, ref mi)) return;
        int waLeft = mi.rcWork.Left;
        int waTop = mi.rcWork.Top;
        int waRight = mi.rcWork.Right;
        int waBottom = mi.rcWork.Bottom;

        foreach (IntPtr h in pets)
        {
            RECT r;
            if (!GetWindowRect(h, out r)) continue;
            int w = r.Right - r.Left;
            int hgt = r.Bottom - r.Top;
            if (w <= 0 || hgt <= 0) continue;

            int visLeft = Math.Max(r.Left, waLeft);
            int visTop = Math.Max(r.Top, waTop);
            int visRight = Math.Min(r.Right, waRight);
            int visBottom = Math.Min(r.Bottom, waBottom);
            int visW = Math.Max(0, visRight - visLeft);
            int visH = Math.Max(0, visBottom - visTop);
            // 可见面积不到一半才算“跑出去了”，避免正常贴边时被反复挪动
            if (visW * visH >= (w * hgt) * 35 / 100) continue; // 可见面积≥35% 就不动，避免与渲染端抢位置

            int nx = waRight - w - 24;
            int ny = waTop + 100;
            if (nx < waLeft) nx = waLeft;
            if (ny + hgt > waBottom) ny = Math.Max(waTop, waBottom - hgt);
            MoveWindow(h, nx, ny, w, hgt, true);
            Log(cfg, "pet window off-screen (" + r.Left + "," + r.Top + ") -> moved to (" + nx + "," + ny + ")");
        }
    }

    private static List<IntPtr> EnumDshPetWindows()
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            if (IsDshPetWindow(hwnd)) found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // ------------------------------------------------------------------ 看门循环

    private static void RunGuardian(Process host, GuardConfig cfg)
    {
        bool anyWork = cfg.HideOnFullscreen || cfg.HideDshPetAlways;

        using (Mutex guardianMutex = new Mutex(false, GuardianMutexName))
        {
            bool owns;
            try
            {
                owns = guardianMutex.WaitOne(0);
            }
            catch (AbandonedMutexException)
            {
                owns = true;
            }
            if (!owns)
            {
                Log(cfg, "another guardian is already running, this one exits");
                return;
            }

            Log(cfg, "guardian started, poll=" + cfg.PollMs + "ms, hide_on_fullscreen=" + cfg.HideOnFullscreen +
                ", hide_dsh_pet_always=" + cfg.HideDshPetAlways + ", also_hide_dsh_pet=" + cfg.AlsoHideDshPet);
            HashSet<IntPtr> hidden = new HashSet<IntPtr>();
            HashSet<IntPtr> hiddenDsh = new HashSet<IntPtr>();
            bool wasFullscreen = false;
            DateTime lastCfgStamp = File.Exists(ConfigPath()) ? File.GetLastWriteTimeUtc(ConfigPath()) : DateTime.MinValue;

            try
            {
                while (true)
                {
                    if (host.HasExited)
                    {
                        Log(cfg, "pet exited, guardian stops");
                        break;
                    }

                    // C. 监视 guard.ini：右键菜单切换「系统通知接管」后立即生效（不用重启桌宠）
                    try
                    {
                        DateTime stamp = File.Exists(ConfigPath()) ? File.GetLastWriteTimeUtc(ConfigPath()) : DateTime.MinValue;
                        if (stamp != lastCfgStamp)
                        {
                            lastCfgStamp = stamp;
                            GuardConfig fresh = LoadConfig();
                            bool notified = fresh.TakeoverNotifications != cfg.TakeoverNotifications;
                            cfg.TakeoverNotifications = fresh.TakeoverNotifications;
                            cfg.HideOnFullscreen = fresh.HideOnFullscreen;
                            cfg.HideDshPetAlways = fresh.HideDshPetAlways;
                            cfg.AlsoHideDshPet = fresh.AlsoHideDshPet;
                            if (fresh.PollMs > 0) cfg.PollMs = fresh.PollMs;
                            anyWork = cfg.HideOnFullscreen || cfg.HideDshPetAlways;
                            if (notified)
                            {
                                if (cfg.TakeoverNotifications) SuppressNotifications(cfg);
                                else RestoreNotifications(cfg);
                                Log(cfg, "notification takeover switched by menu: " + (cfg.TakeoverNotifications ? "on" : "off"));
                            }
                            else
                            {
                                Log(cfg, "guard.ini reloaded");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Log(cfg, "reload guard.ini failed: " + ex.Message);
                    }

                    // A. 始终隐藏 DSH 自带的那只（避免两只叠在一起）
                    if (cfg.HideDshPetAlways)
                    {
                        List<IntPtr> dshPets = EnumDshPetWindows();
                        int newlyHidden = 0;
                        foreach (IntPtr h in dshPets)
                        {
                            if (IsWindowVisible(h))
                            {
                                ShowWindow(h, SW_HIDE);
                                hiddenDsh.Add(h);
                                newlyHidden++;
                            }
                        }
                        if (newlyHidden > 0)
                        {
                            Log(cfg, "hide dsh pet window (" + hiddenDsh.Count + " in total)");
                        }
                    }

                    // B. 全屏应用时隐藏自己的桌宠
                    if (cfg.HideOnFullscreen)
                    {
                        bool fullscreen;
                        try
                        {
                            fullscreen = IsForegroundFullscreen(cfg);
                        }
                        catch (Exception)
                        {
                            fullscreen = false;
                        }

                        if (fullscreen)
                        {
                            List<IntPtr> pets = EnumOwnPetWindows();
                            if (cfg.AlsoHideDshPet && !cfg.HideDshPetAlways) pets.AddRange(EnumDshPetWindows());
                            bool changed = false;
                            foreach (IntPtr h in pets)
                            {
                                if (IsWindowVisible(h))
                                {
                                    ShowWindow(h, SW_HIDE);
                                    hidden.Add(h);
                                    changed = true;
                                }
                            }
                            if (changed || !wasFullscreen)
                            {
                                IntPtr fg = GetForegroundWindow();
                                Log(cfg, "fullscreen: " + TitleOf(fg) + " -> hide pet (" + hidden.Count + " window)");
                            }
                        }
                        else if (hidden.Count > 0)
                        {
                            int shown = 0;
                            foreach (IntPtr h in hidden)
                            {
                                if (IsWindow(h) && !IsWindowVisible(h) && !hiddenDsh.Contains(h))
                                {
                                    ShowWindow(h, SW_SHOWNA);
                                    shown++;
                                }
                            }
                            hidden.Clear();
                            Log(cfg, "not fullscreen anymore -> show pet (" + shown + " window)");
                        }

                        if (!fullscreen)
                        {
                            try
                            {
                                EnsureOnScreen(cfg);
                            }
                            catch (Exception)
                            {
                            }
                        }

                        wasFullscreen = fullscreen;
                    }

                    if (!anyWork) Thread.Sleep(500);
                    else Thread.Sleep(cfg.PollMs);
                }
            }
            finally
            {
                // 退出前把 DSH 那只恢复出来
                try
                {
                    int shown = 0;
                    foreach (IntPtr h in hiddenDsh)
                    {
                        if (IsWindow(h) && !IsWindowVisible(h))
                        {
                            ShowWindow(h, SW_SHOWNA);
                            shown++;
                        }
                    }
                    if (hiddenDsh.Count > 0) Log(cfg, "guardian exit -> restore dsh pet (" + shown + " window)");
                }
                catch (Exception)
                {
                }
            }
        }
    }


    // ------------------------------------------------------------------ 入口

    [STAThread]
    private static int Main(string[] args)
    {
        bool stopOnly = false;
        bool autostart = false;
        bool installAuto = false;
        bool uninstallAuto = false;
        bool statusOnly = false;

        foreach (string arg in args)
        {
            string a = arg.Trim().ToLowerInvariant();
            if (a == "/stop" || a == "--stop" || a == "-stop") stopOnly = true;
            else if (a == "--autostart" || a == "/autostart") autostart = true;
            else if (a == "/install-autostart" || a == "--install-autostart") installAuto = true;
            else if (a == "/uninstall-autostart" || a == "--uninstall-autostart") uninstallAuto = true;
            else if (a == "/status" || a == "--status") statusOnly = true;
        }

        GuardConfig cfg = LoadConfig();

        if (installAuto)
        {
            try
            {
                InstallAutostart();
                MessageBox.Show("已设置开机自启：\r\n下次登录 Windows 时桌宠会自动出现。\r\n\r\n取消方法：再运行 DSH-Pet.exe /uninstall-autostart",
                    AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("设置开机自启失败：" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        if (uninstallAuto)
        {
            try
            {
                UninstallAutostart();
                MessageBox.Show("已取消开机自启。", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("取消开机自启失败：" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        if (statusOnly)
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("开机自启：" + (AutostartInstalled() ? "已开启" : "未开启"));
            sb.AppendLine("桌宠进程：" + (FindRunningHosts().Count > 0 ? "运行中" : "未运行"));
            sb.AppendLine("全屏自动隐藏：" + (cfg.HideOnFullscreen ? "开启" : "关闭") + "（guard.ini）");
            sb.AppendLine("常隐 DSH 桌宠：" + (cfg.HideDshPetAlways ? "开启" : "关闭") + "（guard.ini）");
            sb.AppendLine("系统通知接管：已移除（只播报 DSH 自身通知）");
            MessageBox.Show(sb.ToString(), AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        if (stopOnly)
        {
            bool stopped = StopPet();
            RestoreNotifications(cfg);
            RestoreDshToast(cfg);
            return stopped ? 0 : 1;
        }

        EnsureFirstRun(cfg);
        MuteDshToast(cfg);

        Process host = null;
        using (Mutex shortMutex = new Mutex(false, ShortMutexName))
        {
            bool owns;
            try
            {
                owns = shortMutex.WaitOne(5000);
            }
            catch (AbandonedMutexException)
            {
                owns = true;
            }
            if (!owns) return 0;

            try
            {
                if (FindRunningHosts().Count > 0)
                {
                    if (autostart) return 0;
                    DialogResult answer = MessageBox.Show(
                        "桌宠正在运行。\r\n\r\n要退出桌宠吗？",
                        AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                        MessageBoxDefaultButton.Button2);
                    if (answer == DialogResult.Yes)
                    {
                        StopPet();
                        RestoreNotifications(cfg);
                        RestoreDshToast(cfg);
                        Thread.Sleep(600);
                    }
                    return 0;
                }

                SuppressNotifications(cfg);
                host = StartPet();
                if (host == null)
                {
                    RestoreNotifications(cfg);
                    RestoreDshToast(cfg);
                    return 1;
                }
                // 给宿主一点时间把 helper 窗口建出来，之后释放短互斥锁
                Thread.Sleep(500);
            }
            finally
            {
                try
                {
                    shortMutex.ReleaseMutex();
                }
                catch (Exception)
                {
                }
            }
        }

        try
        {
            RunGuardian(host, cfg);
        }
        finally
        {
            RestoreNotifications(cfg);
            RestoreDshToast(cfg);
        }
        return 0;
    }
}
