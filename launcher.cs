using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

/* ============ 给网页用的宿主对象：弹系统原生的「选择文件夹」窗口 ============ */
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class HostBridge
{
    // 网页调用本对象的方法时，WebView2 会在后台线程上执行；弹窗口必须回到 UI 线程
    // （否则对话框根本不显示、调用会一直挂着，这是实测踩到的坑）。
    public static System.Windows.Forms.Form Ui;

    public string PickFolder(string title, string initial)
    {
        // 网页调用宿主对象的方法时并不在主线程上（也不一定是 STA），
        // 直接在这里弹 Shell 对话框会“没有窗口、调用一直挂着”。
        // 所以单开一个 STA 线程，让它自己跑对话框的消息循环。
        try
        {
            if (Ui != null && !Ui.InvokeRequired) return UiPick(title, initial);

            string result = "";
            System.Threading.Thread t = new System.Threading.Thread(delegate ()
            {
                try { result = PickCore(title, initial); }
                catch { result = ""; }
            });
            t.SetApartmentState(System.Threading.ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            t.Join();
            return result == null ? "" : result;
        }
        catch { return ""; }
    }

    static string UiPick(string title, string initial)
    {
        string p = PickCore(title, initial);
        return p == null ? "" : p;
    }

    // 取消返回 null（由上层转成空串）；只有接口本身不可用才退回旧对话框
    static string PickCore(string title, string initial)
    {
        try { return NativeFolderDialog.Pick(title, initial); }
        catch { return LegacyPick(title, initial); }
    }

    static string LegacyPick(string title, string initial)
    {
        try
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = string.IsNullOrEmpty(title) ? "选择文件夹" : title;
                d.ShowNewFolderButton = false;
                try { d.RootFolder = Environment.SpecialFolder.Desktop; } catch { }
                if (!string.IsNullOrEmpty(initial) && Directory.Exists(initial)) d.SelectedPath = initial;
                return d.ShowDialog() == DialogResult.OK ? d.SelectedPath : "";
            }
        }
        catch { return ""; }
    }
}

/* ============ Vista 风格文件夹选择框（IFileOpenDialog） ============ */
static class NativeFolderDialog
{
    const uint FOS_PICKFOLDERS = 0x00000020;
    const uint FOS_FORCEFILESYSTEM = 0x00000040;
    const uint FOS_PATHMUSTEXIST = 0x00000800;
    const uint FOS_NOCHANGEDIR = 0x00000008;
    const uint SIGDN_FILESYSPATH = 0x80058000;

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    class FileOpenDialogRCW { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName(out IntPtr pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    // 返回 null 表示用户取消；抛异常表示这套接口不可用（交给调用方退回旧对话框）
    public static string Pick(string title, string initial)
    {
        IFileOpenDialog dlg = (IFileOpenDialog)new FileOpenDialogRCW();
        dlg.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR);
        if (!string.IsNullOrEmpty(title)) dlg.SetTitle(title);
        try { dlg.SetOkButtonLabel("选这个文件夹"); } catch { }
        int hr = dlg.Show(IntPtr.Zero);
        if (hr != 0) return null;   // 取消或关闭
        IShellItem item;
        dlg.GetResult(out item);
        IntPtr name;
        item.GetDisplayName(SIGDN_FILESYSPATH, out name);
        string result = Marshal.PtrToStringUni(name);
        Marshal.FreeCoTaskMem(name);
        return result;
    }
}

class AppForm : Form
{
    public static AppForm Current;

    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    static Mutex single;
    static string appDir;
    static int port = 7788;
    static Process nodeProc;
    static bool weStartedNode;

    WebView2 web;
    Label splash;
    string url;

    [STAThread]
    static void Main()
    {
        SetProcessDPIAware(); // 让界面按真实像素渲染，避免 125% 缩放下被放大裁切
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // 单实例：已经开着就把那个窗口调到前面，不再开第二个
        bool created;
        single = new Mutex(true, "CourseLib_SingleInstance_9F3A", out created);
        if (!created)
        {
            foreach (Process other in Process.GetProcessesByName("教学文件管理"))
            {
                if (other.Id == Process.GetCurrentProcess().Id) continue;
                IntPtr h = other.MainWindowHandle;
                if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); break; }
            }
            return;
        }

        appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        port = ReadPort(Path.Combine(appDir, "config.json"), 7788);
        string url = "http://127.0.0.1:" + port;

        // 如果已经有一个本程序的服务在跑（或端口被别的程序占了），先看看本程序是否已就绪
        if (!IsOurs(port))
        {
            try { File.Delete(Path.Combine(appDir, "port.txt")); } catch { }

            string nodeExe = FindNode();
            if (nodeExe == null)
            {
                MessageBox.Show("找不到运行引擎。\n\n程序文件夹里应该有 runtime\\node.exe。若被误删，从别处复制一个 node.exe 放进 runtime 文件夹即可。",
                    "教学文件管理", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            string server = Path.Combine(appDir, "server.js");
            if (!File.Exists(server))
            {
                MessageBox.Show("程序文件不完整，缺少 server.js：\n" + appDir,
                    "教学文件管理", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\"" + server + "\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            try { psi.EnvironmentVariables["NO_BROWSER"] = "1"; } catch { }

            try { nodeProc = Process.Start(psi); weStartedNode = true; }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message, "教学文件管理", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            try
            {
                nodeProc.EnableRaisingEvents = true;
                nodeProc.Exited += delegate
                {
                    try
                    {
                        AppForm f = AppForm.Current;
                        if (f != null && !f.IsDisposed)
                        {
                            f.BeginInvoke(new Action(delegate { if (!f.IsDisposed) f.Close(); }));
                        }
                    }
                    catch { }
                };
            }
            catch { }

            int actual = WaitServer(25000);
            if (actual <= 0)
            {
                MessageBox.Show("服务没有起来。\n\n可能是端口被占用，或 runtime\\node.exe 被删、被杀毒软件隔离。\n也可以双击 启动.bat 看具体报错。",
                    "教学文件管理", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                KillNode();
                return;
            }
            port = actual;
            url = "http://127.0.0.1:" + port;
        }
        else
        {
            // 端口已在监听：可能是上次没退干净的自己，也可能是别的程序；读 port.txt 校正
            int noted = ReadPortFile();
            if (noted > 0 && noted != port && IsOurs(noted)) { port = noted; url = "http://127.0.0.1:" + port; }
        }

        Application.Run(new AppForm(url));
        KillNode();
    }

    public AppForm(string pageUrl)
    {
        url = pageUrl;
        Text = "教学文件管理";
        Rectangle wa = Screen.PrimaryScreen.WorkingArea;
        Width = Math.Min(1180, wa.Width - 80);
        Height = Math.Min(860, wa.Height - 80);
        MinimumSize = new Size(980, 640);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        BackColor = Color.FromArgb(247, 248, 251);
        try
        {
            Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("AppIcon.ico");
            if (s != null) Icon = new Icon(s);
        }
        catch { }

        splash = new Label();
        splash.Text = "正在启动教学文件管理…";
        splash.Font = new Font("Microsoft YaHei", 14F);
        splash.ForeColor = Color.FromArgb(90, 98, 112);
        splash.Dock = DockStyle.Fill;
        splash.TextAlign = ContentAlignment.MiddleCenter;
        Controls.Add(splash);

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.Visible = false;
        Controls.Add(web);

        Shown += OnShown;
        FormClosing += delegate { KillNode(); };
    }

    async void OnShown(object sender, EventArgs e)
    {
        try
        {
            string dataDir = Path.Combine(appDir, "ui-data");
            try { Directory.CreateDirectory(dataDir); } catch { }
            // 关掉 Edge 账户同步 / 首次运行提示（否则会弹出“正在同步你的浏览数据”大窗口）
            CoreWebView2EnvironmentOptions opts = new CoreWebView2EnvironmentOptions(
                "--guest --no-first-run --disable-sync --disable-background-networking --disable-component-update " +
                "--disable-features=msEdgeIdentityFRE,msEdgeSync,msImplicitSignin,msEdgeSidebarV2,msEdgeCollections,msEdgeWorkspaces,EdgeCollections,msEdgeReadAloud");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir, opts);
            AppForm.Current = this;
            await web.EnsureCoreWebView2Async(env);

            CoreWebView2 core = web.CoreWebView2;
            try
            {
                HostBridge.Ui = this;
                core.AddHostObjectToScript("host", new HostBridge());
            }
            catch { }
            core.WebMessageReceived += delegate (object s2, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = "";
                try { msg = a.TryGetWebMessageAsString() ?? ""; } catch { }
                if (msg == "quit")
                {
                    try { this.BeginInvoke(new Action(delegate { this.Close(); })); } catch { }
                }
                if (msg == "mini")
                {
                    // 让资源管理器露出来：先最小化自己，1.6 秒后以「不激活」方式还原
                    try
                    {
                        this.BeginInvoke(new Action(delegate
                        {
                            try { this.WindowState = FormWindowState.Minimized; } catch { }
                            var t = new System.Windows.Forms.Timer();
                            t.Interval = 1700;
                            t.Tick += delegate (object ts, EventArgs te)
                            {
                                t.Stop();
                                try { ShowWindow(this.Handle, 4); } catch { }
                            };
                            t.Start();
                        }));
                    }
                    catch { }
                }
            };
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            core.NewWindowRequested += delegate (object s2, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                try { core.Navigate(a.Uri); } catch { }
            };
            core.DocumentTitleChanged += delegate
            {
                try
                {
                    string t = core.DocumentTitle;
                    if (!string.IsNullOrEmpty(t)) Text = t;
                }
                catch { }
            };

            core.Navigate(url);
            web.Visible = true;
            splash.Visible = false;
        }
        catch (Exception ex)
        {
            splash.Text = "界面初始化失败：\n" + ex.Message +
                "\n\n请确认电脑上有 Microsoft Edge WebView2 运行时（Windows 一般自带）。";
            splash.ForeColor = Color.FromArgb(200, 60, 60);
        }
    }

    // 判断某个端口上跑的是不是本程序的服务（响应里带 \"ok\":true 与 \"root\"）
    static bool IsOurs(int p)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/api/status");
            req.Timeout = 900;
            req.ReadWriteTimeout = 900;
            req.Proxy = null;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
            using (StreamReader rd = new StreamReader(res.GetResponseStream()))
            {
                string body = rd.ReadToEnd();
                return body.Contains("\"ok\":true") && body.Contains("\"root\"");
            }
        }
        catch { return false; }
    }

    static int ReadPortFile()
    {
        try
        {
            string p = Path.Combine(appDir, "port.txt");
            if (!File.Exists(p)) return 0;
            string txt = File.ReadAllText(p).Trim();
            int v;
            if (int.TryParse(txt, out v) && v > 1024 && v < 65536) return v;
        }
        catch { }
        return 0;
    }

    // 等待服务就绪：优先认 port.txt 里 server 实际用的端口（端口被占时它会自动 +1）
    static int WaitServer(int timeoutMs)
    {
        int waited = 0;
        while (waited < timeoutMs)
        {
            int noted = ReadPortFile();
            if (noted > 0 && IsOurs(noted)) return noted;
            if (nodeProc != null && nodeProc.HasExited) return 0;
            if (IsOurs(port)) return port;
            Thread.Sleep(200);
            waited += 200;
        }
        return 0;
    }

    static int ReadPort(string cfgPath, int fallback)
    {
        try
        {
            if (File.Exists(cfgPath))
            {
                string raw = File.ReadAllText(cfgPath);
                Match m = Regex.Match(raw, "\"port\"\\s*:\\s*([0-9]+)");
                if (m.Success) return int.Parse(m.Groups[1].Value);
            }
        }
        catch { }
        return fallback;
    }

    static string FindNode()
    {
        string bundled = Path.Combine(appDir, @"runtime\node.exe");
        try { if (File.Exists(bundled)) return bundled; } catch { }
        string[] tries = new string[] {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe"
        };
        foreach (string t in tries) { try { if (File.Exists(t)) return t; } catch { } }
        return null;
    }

    static bool PortOpen(int p)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult ar = c.BeginConnect("127.0.0.1", p, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(400)) return false;
                c.EndConnect(ar);
                return true;
            }
        }
        catch { return false; }
    }

    static void KillNode()
    {
        if (!weStartedNode) return;
        try { if (nodeProc != null && !nodeProc.HasExited) nodeProc.Kill(); }
        catch { }
    }
}
