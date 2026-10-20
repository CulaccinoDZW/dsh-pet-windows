using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DshPetSetup
{
    internal static class Program
    {
        internal static bool Silent;
        internal static string SilentTarget;

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            foreach (string a in args)
            {
                if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "/silent", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "/quiet", StringComparison.OrdinalIgnoreCase))
                {
                    Silent = true;
                }
                else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))
                {
                    SilentTarget = a.Substring(3).Trim('"');
                }
            }
            Application.Run(new SetupForm());
        }
    }

    internal sealed class SetupForm : Form
    {
        private const string PayloadResource = "DSH-Pet-Payload.tar.zst";
        private const string UninstallResource = "DSH-Pet-Uninstall.exe";
        private const string AppId = "DSH-Pet";
        private const string AppName = "鲸鱼娘";
        private const string AppVer = "0.3.7";

        private readonly TextBox _pathBox;
        private readonly CheckBox _desktop;
        private readonly CheckBox _autostart;
        private readonly CheckBox _launch;
        private readonly CheckBox _configure;
        private readonly Button _installButton;
        private readonly Button _closeButton;
        private readonly ProgressBar _progress;
        private readonly TextBox _log;
        private readonly bool _silent;
        private bool _done;

        public SetupForm()
        {
            Text = "鲸鱼娘 安装程序";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(620, 470);
            Font = new Font("Microsoft YaHei UI", 9f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            Label title = new Label();
            title.Text = "安装 鲸鱼娘（dsh-pet 独立版）";
            title.Font = new Font("Microsoft YaHei UI", 13f, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(18, 16);
            Controls.Add(title);

            Label sub = new Label();
            sub.Text = "桌面小女仆桌宠：动画 / 拖拽 / 右键菜单 / AI 对话 / 开机自启 / 全屏自动隐藏 / 系统通知接管。\r\n不需要安装 Node.js 或 DeepSeek Harness。";
            sub.ForeColor = Color.DimGray;
            sub.AutoSize = true;
            sub.Location = new Point(20, 50);
            Controls.Add(sub);

            Label l1 = new Label();
            l1.Text = "安装位置：";
            l1.AutoSize = true;
            l1.Location = new Point(20, 100);
            Controls.Add(l1);

            _pathBox = new TextBox();
            _pathBox.Location = new Point(95, 97);
            _pathBox.Width = 404;
            _pathBox.Text = DefaultTarget();
            Controls.Add(_pathBox);

            Button browse = new Button();
            browse.Text = "浏览…";
            browse.Location = new Point(505, 95);
            browse.Width = 90;
            browse.Height = 26;
            browse.Click += delegate
            {
                using (FolderBrowserDialog dlg = new FolderBrowserDialog())
                {
                    dlg.Description = "选择鲸鱼娘的安装文件夹";
                    dlg.ShowNewFolderButton = true;
                    string cur = _pathBox.Text.Trim();
                    try { if (cur.Length > 0 && Directory.Exists(cur)) dlg.SelectedPath = cur; } catch { }
                    if (dlg.ShowDialog(this) == DialogResult.OK && dlg.SelectedPath.Length > 0)
                    {
                        // 用户选中的目录下自动建子目录，避免直接铺满所选文件夹
                        _pathBox.Text = Path.Combine(dlg.SelectedPath, "DSH-Pet");
                    }
                }
            };
            Controls.Add(browse);

            _desktop = new CheckBox();
            _desktop.Text = "创建桌面快捷方式";
            _desktop.Checked = true;
            _desktop.AutoSize = true;
            _desktop.Location = new Point(95, 128);
            Controls.Add(_desktop);

            _autostart = new CheckBox();
            _autostart.Text = "开机自动启动桌宠（推荐）";
            _autostart.Checked = true;
            _autostart.AutoSize = true;
            _autostart.Location = new Point(285, 128);
            Controls.Add(_autostart);

            _configure = new CheckBox();
            _configure.Text = "安装完成后运行一键配置（会请求管理员权限）";
            _configure.Checked = true;
            _configure.AutoSize = true;
            _configure.Location = new Point(95, 176);
            Controls.Add(_configure);
            _launch = new CheckBox();
            _launch.Text = "安装完成后立即启动桌宠";
            _launch.Checked = true;
            _launch.AutoSize = true;
            _launch.Location = new Point(95, 152);
            Controls.Add(_launch);

            Label l2 = new Label();
            l2.Text = "安装日志：";
            l2.AutoSize = true;
            l2.Location = new Point(20, 206);
            Controls.Add(l2);

            _log = new TextBox();
            _log.Location = new Point(95, 224);
            _log.Width = 500;
            _log.Height = 136;
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.BackColor = Color.White;
            _log.Font = new Font("Consolas", 9f);
            Controls.Add(_log);

            _progress = new ProgressBar();
            _progress.Location = new Point(95, 368);
            _progress.Width = 500;
            _progress.Height = 16;
            Controls.Add(_progress);

            _installButton = new Button();
            _installButton.Text = "开始安装";
            _installButton.Location = new Point(390, 392);
            _installButton.Width = 100;
            _installButton.Height = 32;
            _installButton.Click += OnInstall;
            Controls.Add(_installButton);

            _closeButton = new Button();
            _closeButton.Text = "取消";
            _closeButton.Location = new Point(500, 392);
            _closeButton.Width = 95;
            _closeButton.Height = 32;
            _closeButton.Click += delegate { Close(); };
            Controls.Add(_closeButton);

            _silent = Program.Silent;
            if (_silent)
            {
                ShowInTaskbar = false;
                WindowState = FormWindowState.Minimized;
                Opacity = 0;
                _pathBox.Text = string.IsNullOrEmpty(Program.SilentTarget) ? DefaultTarget() : Program.SilentTarget;
                Shown += delegate { BeginInvoke(new Action(StartSilentInstall)); };
            }
        }

        private void StartSilentInstall()
        {
            string target = _pathBox.Text.Trim();
            try { target = Path.GetFullPath(target); }
            catch { _done = true; Close(); return; }
            _installButton.Enabled = false;
            _closeButton.Enabled = false;
            _log.Clear();
            Thread worker = new Thread(new ThreadStart(delegate { DoInstall(target); }));
            worker.IsBackground = true;
            worker.Start();
        }

        private static string DefaultTarget()
        {
            return Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"), "DSH-Pet");
        }

        private void Append(string text)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Append), text); return; }
            _log.AppendText(text + "\r\n");
        }

        private void SetProgress(int percent)
        {
            if (InvokeRequired) { BeginInvoke(new Action<int>(SetProgress), percent); return; }
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            _progress.Value = percent;
        }

        private void Fail(string message)
        {
            _done = true;
            _installButton.Enabled = true;
            _closeButton.Text = "关闭";
            Append("失败：" + message);
            if (_silent) { Close(); return; }
            MessageBox.Show(this, message, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        private static void CloseSettingsWindows()
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName("SystemSettings"))
                {
                    try
                    {
                        if (p.MainWindowHandle != IntPtr.Zero) p.CloseMainWindow();
                        else p.Kill();
                    }
                    catch { }
                }
            }
            catch { }
        }
        private void Succeed(string target)
        {
            _done = true;
            _closeButton.Text = "完成";
            _closeButton.Enabled = true;
            _installButton.Enabled = false;
            _installButton.Text = "已安装";
            _pathBox.Enabled = false;
            _desktop.Enabled = false;
            _autostart.Enabled = false;
            _launch.Enabled = false;
            try { _closeButton.Focus(); } catch { }
            SetProgress(100);
            if (_silent) { Close(); return; }
            MessageBox.Show(this,
                "安装完成！\r\n\r\n安装位置：" + target + "\r\n\r\n" +
                "· 桌宠已添加到「开始」菜单" + (_desktop.Checked ? "和桌面" : "") + "\r\n" +
                "· 右键桌宠可以开关 AI 对话、速聊、动作、退出\r\n" +
                "· 退出：右键 → 退出，或再次运行 DSH-Pet.exe\r\n" +
                "· 卸载：Windows 设置 → 应用 → 「鲸鱼娘」",
                "安装完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void OnInstall(object sender, EventArgs e)
        {
            if (_done) { Close(); return; }
            string target = _pathBox.Text.Trim();
            if (target.Length == 0) { MessageBox.Show(this, "请填写安装位置。", "提示"); return; }
            try { target = Path.GetFullPath(target); } catch { MessageBox.Show(this, "安装路径不合法。", "提示"); return; }
            if (Directory.Exists(target) && File.Exists(Path.Combine(target, "DSH-Pet.exe")))
            {
                if (MessageBox.Show(this, "该位置已经有鲸鱼娘，是否覆盖安装（保留配置）？", "已安装",
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            }
            _installButton.Enabled = false;
            _closeButton.Enabled = false;
            _pathBox.Enabled = false;
            _desktop.Enabled = false;
            _autostart.Enabled = false;
            _launch.Enabled = false;
            _log.Clear();
            Thread worker = new Thread(new ThreadStart(delegate { DoInstall(target); }));
            worker.IsBackground = true;
            worker.Start();
        }

        private void DoInstall(string target)
        {
            try
            {
                Append("安装位置：" + target);
                SetProgress(1);

                if (File.Exists(Path.Combine(target, "DSH-Pet.exe")))
                {
                    Append("检测到旧版本在运行的话先停掉…");
                    StopExisting(target);
                }

                if (!Directory.Exists(target)) Directory.CreateDirectory(target);

                Append("正在解压程序文件（约 420 MB，首次安装需要几十秒）…");
                ExtractPayload(target);

                Append("写入卸载程序…");
                ExtractUninstaller(target);

                Append("写入首次运行标记…");
                File.WriteAllText(Path.Combine(target, "installed.flag"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), Encoding.UTF8);

                Append("写入开始菜单快捷方式…");
                string startMenu = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string iconFile = Path.Combine(target, "DSH-Pet.ico");
                if (!File.Exists(iconFile)) iconFile = Path.Combine(target, "DSH-Pet.exe");
                CreateShortcut(Path.Combine(startMenu, AppName + ".lnk"), Path.Combine(target, "DSH-Pet.exe"), "",
                    "鲸鱼娘（dsh-pet 独立版）", iconFile);
                if (_desktop.Checked)
                {
                    Append("写入桌面快捷方式…");
                    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateShortcut(Path.Combine(desktop, AppName + ".lnk"), Path.Combine(target, "DSH-Pet.exe"), "",
                        "鲸鱼娘（dsh-pet 独立版）", iconFile);
                }

                Append("刷新图标缓存…");
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "ie4uinit.exe"), "-show");
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    using (Process p = Process.Start(psi))
                    {
                        if (p != null) p.WaitForExit(4000);
                    }
                }
                catch { }

                if (_autostart.Checked)
                {
                    Append("注册开机自启…");
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
                    {
                        k.SetValue(AppId, "\"" + Path.Combine(target, "DSH-Pet.exe") + "\" --autostart", RegistryValueKind.String);
                    }
                }
                else
                {
                    Append("未勾选开机自启，跳过。");
                }

                Append("写入系统「应用和功能」卸载项…");
                WriteUninstallEntry(target);

                SetProgress(100);
                Append("安装完成。");
                if ((bool)Invoke(new Func<bool>(delegate { return _configure.Checked; })))
                {
                    Append("运行一键配置（管理员）…");
                    try
                    {
                        string wizard = Path.Combine(target, "配置环境.ps1");
                        if (File.Exists(wizard))
                        {
                            ProcessStartInfo psi2 = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + wizard + "\"");
                            psi2.UseShellExecute = true;
                            psi2.Verb = "runas";
                            psi2.WorkingDirectory = target;
                            Process wp = Process.Start(psi2);
                            try { wp.WaitForExit(60000); } catch { }
                            CloseSettingsWindows();
                        }
                        else Append("未找到 配置环境.ps1，跳过。");
                    }
                    catch (Exception ex) { Append("一键配置未运行：" + ex.Message); }
                }

                bool launch = (bool)Invoke(new Func<bool>(delegate { return _launch.Checked; }));
                if (launch)
                {
                    Append("正在启动桌宠…");
                    try { Process.Start(new ProcessStartInfo(Path.Combine(target, "DSH-Pet.exe")) { WorkingDirectory = target, UseShellExecute = true }); }
                    catch (Exception ex) { Append("启动失败：" + ex.Message); }
                }
                BeginInvoke(new Action<string>(Succeed), target);
            }
            catch (Exception ex)
            {
                BeginInvoke(new Action<string>(Fail), ex.Message);
            }
        }

        private static void StopExisting(string target)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(target, "DSH-Pet.exe"), "/stop");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = target;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(10000);
                }
                Thread.Sleep(1500);
            }
            catch { }
        }

        private void ExtractPayload(string target)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string tarExe = Path.Combine(Environment.SystemDirectory, "tar.exe");
            if (!File.Exists(tarExe))
                throw new Exception("当前系统缺少 tar.exe（Windows 10 1803 及以上自带），无法解压安装包；请改用便携版 zip。");
            string tmp = Path.Combine(Path.GetTempPath(), "DSH-Pet-payload-" + Guid.NewGuid().ToString("N") + ".tar.zst");
            try
            {
                using (Stream res = asm.GetManifestResourceStream(PayloadResource))
                {
                    if (res == null) throw new Exception("安装包损坏：找不到内置数据（" + PayloadResource + "）");
                    using (FileStream fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
                    {
                        byte[] buf = new byte[262144];
                        int n;
                        while ((n = res.Read(buf, 0, buf.Length)) > 0) fs.Write(buf, 0, n);
                    }
                }
                Append("开始解压运行时（约 20~60 秒，请稍候）…");
                SetProgress(3);
                ProcessStartInfo psi = new ProcessStartInfo(tarExe,
                    "--zstd -xf \"" + tmp + "\" -C \"" + target + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardError = true;
                psi.RedirectStandardOutput = true;
                using (Process p = Process.Start(psi))
                {
                    string err = p.StandardError.ReadToEnd();
                    p.StandardOutput.ReadToEnd();
                    p.WaitForExit();
                    if (p.ExitCode != 0)
                        throw new Exception("解压失败（tar 退出码 " + p.ExitCode + "）：" + err);
                }
                SetProgress(90);
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            }
        }

        private static void ExtractUninstaller(string target)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream res = asm.GetManifestResourceStream(UninstallResource))
            {
                if (res == null) throw new Exception("安装包损坏：找不到卸载程序");
                string path = Path.Combine(target, "Uninstall.exe");
                using (FileStream fs = new FileStream(path, FileMode.Create, FileAccess.Write))
                {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = res.Read(buf, 0, buf.Length)) > 0) fs.Write(buf, 0, n);
                }
            }
        }

        private static void CreateShortcut(string lnkPath, string target, string args, string description, string iconPath)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) throw new Exception("系统缺少 WScript.Shell，无法创建快捷方式");
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type sct = sc.GetType();
            sct.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            sct.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { args });
            sct.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(target) });
            sct.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { description });
            if (!string.IsNullOrEmpty(iconPath))
                sct.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { iconPath + ",0" });
            sct.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        private void WriteUninstallEntry(string target)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DSH-Pet"))
            {
                k.SetValue("DisplayName", AppName + "（dsh-pet 独立版）", RegistryValueKind.String);
                k.SetValue("DisplayVersion", AppVer, RegistryValueKind.String);
                k.SetValue("Publisher", "dsh-pet / 个人打包", RegistryValueKind.String);
                k.SetValue("DisplayIcon", Path.Combine(target, "DSH-Pet.exe"), RegistryValueKind.String);
                k.SetValue("InstallLocation", target, RegistryValueKind.String);
                k.SetValue("UninstallString", "\"" + Path.Combine(target, "Uninstall.exe") + "\"", RegistryValueKind.String);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                try
                {
                    long size = 0;
                    foreach (FileInfo f in new DirectoryInfo(target).GetFiles("*", SearchOption.AllDirectories)) size += f.Length;
                    k.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
                }
                catch { }
            }
        }
    }
}
