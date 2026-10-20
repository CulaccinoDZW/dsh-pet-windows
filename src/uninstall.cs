using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Management;
using System.Runtime.InteropServices;

namespace DshPetUninstall
{
    internal static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, int dwFlags);
        private const int MOVEFILE_DELAY_UNTIL_REBOOT = 0x4;

        // 删不掉（被进程占用）的文件登记为“下次重启时删除”
        private static void ScheduleDeleteOnReboot(string dir)
        {
            try
            {
                if (!Directory.Exists(dir)) return;
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try { MoveFileEx(f, null, MOVEFILE_DELAY_UNTIL_REBOOT); } catch { }
                }
                try { MoveFileEx(dir, null, MOVEFILE_DELAY_UNTIL_REBOOT); } catch { }
            }
            catch { }
        }

        private const string AppId = "DSH-Pet";
        private const string AppName = "鲸鱼娘";

        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length >= 2 && args[0] == "-cleanup")
            {
                Cleanup(args[1]);
                return;
            }

            string dir = AppDomain.CurrentDomain.BaseDirectory;
            if (dir.EndsWith("\\")) dir = dir.Substring(0, dir.Length - 1);

            bool quiet = false;
            bool keepData = false;
            foreach (string a in args)
            {
                if (a == "/quiet" || a == "/S" || a == "/silent") quiet = true;
                if (a == "/keepdata") keepData = true;
            }

            if (!quiet)
            {
                string msg =
                    "确定要卸载「" + AppName + "」吗？\r\n\r\n" +
                    "安装目录：" + dir + "\r\n\r\n" +
                    "会一并删除（不可恢复）：\r\n" +
                    "  · 独立版配置与 API Key（.dsh\\dsh-pet-standalone）\r\n" +
                    "  · 对话记忆、待办、桌宠位置等全部本地数据\r\n" +
                    "  · 浏览器缓存（%APPDATA%\\dsh-pet-standalone-helper）\r\n" +
                    "  · 桌面/开始菜单快捷方式、开机自启、卸载登记\r\n\r\n" +
                    "（只影响本程序自己的数据，不动 DeepSeek Harness 的任何配置）\r\n\r\n" +
                    "如果想保留配置，请改用命令行参数 /keepdata 卸载。";
                DialogResult r = MessageBox.Show(msg, "卸载 " + AppName,
                    MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
                if (r != DialogResult.OK) return;
            }

            // 不调用 DSH-Pet.exe 的参数（GUI 进程可能卡对话框），直接 taskkill 进程树
            KillProcessesUnder(dir);
            Thread.Sleep(1200);
            TryDeleteRunKey();
            TryDeleteShortcuts();
            TryDeleteUninstallEntry();
            if (!keepData) PurgeUserData();

            try
            {
                string temp = Path.Combine(Path.GetTempPath(), "DSH-Pet-Uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
                File.Copy(Application.ExecutablePath, temp, true);
                ProcessStartInfo psi = new ProcessStartInfo(temp, "-cleanup \"" + dir + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                if (!quiet) MessageBox.Show("清理安装目录失败，请手动删除：" + dir + "\r\n" + ex.Message, "卸载");
            }
        }

        // 强制结束这个安装目录下启动的所有进程（DSH-Pet.exe / electron.exe）
        private static void KillProcessesUnder(string dir)
        {
            // 先用 taskkill 杀掉启动器进程树（最可靠）
            try
            {
                ProcessStartInfo k = new ProcessStartInfo("cmd.exe", "/c taskkill /F /T /IM DSH-Pet.exe >nul 2>&1");
                k.UseShellExecute = false;
                k.CreateNoWindow = true;
                k.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process kp = Process.Start(k)) { if (kp != null) kp.WaitForExit(8000); }
                Thread.Sleep(1500);
            }
            catch { }
            try
            {
                string d = dir.TrimEnd('\\').ToLowerInvariant();
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process"))
                {
                    foreach (ManagementObject mo in searcher.Get())
                    {
                        try
                        {
                            string exe = Convert.ToString(mo["ExecutablePath"]);
                            if (string.IsNullOrEmpty(exe)) continue;
                            string exeLow = exe.ToLowerInvariant();
                            string nameLow = System.IO.Path.GetFileName(exeLow);
                            if (nameLow != "dsh-pet.exe" && nameLow != "electron.exe") continue;
                            if (nameLow == "uninstall.exe") continue;
                            if (!exeLow.StartsWith(d)) continue;
                            object pidObj = mo["ProcessId"];
                            if (pidObj == null) continue;
                            int pid = Convert.ToInt32(pidObj);
                            if (pid == Process.GetCurrentProcess().Id) continue;
                            try
                            {
                                using (Process p = Process.GetProcessById(pid)) { p.Kill(); }
                            }
                            catch { }
                        }
                        catch { }
                    }
                }
            }
            catch { }
            Thread.Sleep(1500);
        }

        private static void RunAndWait(string exe, string args, int timeoutMs, string workDir)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, args);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = workDir;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(timeoutMs);
                }
            }
            catch { }
        }

        // 用户数据：独立版配置(含 API Key)、对话记忆、待办、缓存
        private static void PurgeUserData()
        {
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] targets = new string[]
            {
                Path.Combine(userProfile, ".dsh\\dsh-pet-standalone"),
                Path.Combine(appData, "dsh-pet-standalone-helper"),
                Path.Combine(localAppData, "DSH-Pet-Notify"),
                Path.Combine(localAppData, "dsh-pet-standalone-helper")
            };
            foreach (string t in targets) DeleteTreeWithRetry(t);

            // 如果之前误建过旧版共享目录里的 ai-config（仅当确实存在时）
            try
            {
                string legacy = Path.Combine(userProfile, ".dsh\\dsh-pet\\ai-config.json");
                if (File.Exists(legacy)) File.Delete(legacy);
            }
            catch { }
        }

        private static void DeleteTreeWithRetry(string path)
        {
            for (int i = 0; i < 10; i++)
            {
                try
                {
                    if (!Directory.Exists(path)) return;
                    Directory.Delete(path, true);
                    return;
                }
                catch
                {
                    Thread.Sleep(600);
                }
            }
            // 第 11 次仍失败：交给 cmd 延时强删
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe",
                    "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"" + path + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch { }
        }

        private static void TryDeleteRunKey()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (k != null) k.DeleteValue(AppId, false);
                }
            }
            catch { }
        }

        private static void TryDeleteShortcuts()
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string publicDesktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
                string[] paths = new string[]
                {
                    Path.Combine(desktop, AppName + ".lnk"),
                    Path.Combine(desktop, "DSH 桌宠.lnk"),
                    Path.Combine(desktop, "DSH-Pet.exe.lnk"),
                    Path.Combine(publicDesktop, AppName + ".lnk"),
                    Path.Combine(programs, AppName + ".lnk"),
                    Path.Combine(programs, "DSH 桌宠.lnk"),
                    Path.Combine(programs, "DSH 桌宠 (dsh-pet).lnk")
                };
                foreach (string p in paths)
                {
                    try { if (File.Exists(p)) File.Delete(p); } catch { }
                }
                // 开始菜单目录
                foreach (string d in new string[] { Path.Combine(programs, AppName), Path.Combine(programs, "DSH 桌宠") })
                {
                    try { if (Directory.Exists(d)) Directory.Delete(d, true); } catch { }
                }
            }
            catch { }
        }

        private static void TryDeleteUninstallEntry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DSH-Pet", false);
            }
            catch { }
            try
            {
                Registry.LocalMachine.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DSH-Pet", false);
            }
            catch { }
        }

        private static void Cleanup(string dir)
        {
            Thread.Sleep(1500);
            string self = Application.ExecutablePath;
            for (int i = 0; i < 15; i++)
            {
                try
                {
                    if (!Directory.Exists(dir)) break;
                    Directory.Delete(dir, true);
                    break;
                }
                catch
                {
                    Thread.Sleep(700);
                }
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe",
                    "/c ping -n 3 127.0.0.1 >nul & del /f /q \"" + self + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch { }
        }
    }
}