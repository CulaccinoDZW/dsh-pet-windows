using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DshPetUninstall
{
    internal static class Program
    {
        private const string AppId = "DSH-Pet";
        private const string AppName = "DSH 桌宠";

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

            if (args.Length == 0 || args[0] != "/quiet")
            {
                DialogResult r = MessageBox.Show(
                    "确定要卸载「" + AppName + "」吗？\r\n\r\n" + dir + "\r\n\r\n" +
                    "（你的个性化配置 C:\\Users\\<用户名>\\.dsh\\dsh-pet 会保留）",
                    "卸载 " + AppName, MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (r != DialogResult.OK) return;
            }

            string exe = Path.Combine(dir, "DSH-Pet.exe");
            if (File.Exists(exe))
            {
                RunAndWait(exe, "/stop", 12000, dir);
                Thread.Sleep(800);
                RunAndWait(exe, "/uninstall-autostart", 8000, dir);
                Thread.Sleep(500);
            }

            TryDeleteRunKey();
            TryDeleteShortcuts();
            TryDeleteUninstallEntry();

            // 从临时目录再启动一份自身完成目录清理（安装目录里的 exe 自己删不掉自己）
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
                MessageBox.Show("清理安装目录失败，请手动删除：" + dir + "\r\n" + ex.Message, "卸载");
            }
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
                string[] paths = new string[]
                {
                    Path.Combine(desktop, AppName + ".lnk"),
                    Path.Combine(programs, AppName + ".lnk"),
                    Path.Combine(programs, "DSH 桌宠 (dsh-pet).lnk")
                };
                foreach (string p in paths)
                {
                    try { if (File.Exists(p)) File.Delete(p); } catch { }
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
        }

        private static void Cleanup(string dir)
        {
            Thread.Sleep(1500);
            string self = Application.ExecutablePath;
            for (int i = 0; i < 12; i++)
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
            // 让 cmd 在自身退出后删掉临时副本
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
