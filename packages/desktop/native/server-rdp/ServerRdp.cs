// ZCode Windows RDP transport. Credentials arrive over private stdio, never argv or logs.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

sealed class RdpControl : AxHost {
    public RdpControl(string clsid) : base(clsid) {}
    public object Client { get { return GetOcx(); } }
}
sealed class EmbeddedWindow : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
}
sealed class ManualInputFilter : IMessageFilter {
    public bool PreFilterMessage(ref Message message) {
        // 只观察本 helper UI 线程的真实消息；AI 输入用同步窗口消息，不经过此队列。
        if((message.Msg>=0x0200 && message.Msg<=0x020e) || message.Msg==0x0100 || message.Msg==0x0102 || message.Msg==0x0104) ServerRdp.InteractionRevision++;
        return false;
    }
}
static class ServerRdp {
    internal static int InteractionRevision;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 20000000 };
    static Form Window;
    static RdpControl Control;
    static dynamic Client;
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
    delegate bool EnumChildProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder value, int capacity);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code,uint mapType);
    static string Text(Dictionary<string,object> d, string key) { return d.ContainsKey(key) ? Convert.ToString(d[key]) : ""; }
    static int Number(Dictionary<string,object> d, string key, int fallback) { return d.ContainsKey(key) ? Convert.ToInt32(d[key]) : fallback; }
    static void Reply(string id, bool ok, string error, string image, string state) {
        var result = new Dictionary<string,object> { {"id",id}, {"ok",ok}, {"interactionRevision",InteractionRevision} };
        if (error != null) result["error"] = error;
        if (image != null) result["image"] = image;
        if (state != null) result["state"] = state;
        lock(Json) { Console.WriteLine(Json.Serialize(result)); Console.Out.Flush(); }
    }
    static void Handle(Dictionary<string,object> request) {
        string id = Text(request,"id"), op = Text(request,"op");
        try {
            if (op == "connect") {
                Client.Server = Text(request,"host"); Client.UserName = Text(request,"username");
                dynamic settings = Client.AdvancedSettings8;
                settings.RDPPort = Number(request,"port",3389);
                settings.EnableCredSspSupport = true;
                // Never suppress identity verification or enable drive/clipboard redirection.
                settings.AuthenticationLevel = 2;
                settings.RedirectDrives = false; settings.RedirectClipboard = false;
                settings.RedirectPrinters = false; settings.RedirectSmartCards = false;
                settings.ClearTextPassword = Text(request,"password");
                settings.SmartSizing = true;
                Client.DesktopWidth = Math.Max(640,Window.ClientSize.Width);
                Client.DesktopHeight = Math.Max(480,Window.ClientSize.Height);
                Client.Connect();
                Reply(id,true,null,null,"connecting"); return;
            }
            if (op == "bounds") {
                var b = (Dictionary<string,object>)request["bounds"];
                int width=Number(b,"width",0),height=Number(b,"height",0);
                // SmartSizing 改变后，旧截图坐标也不能继续作为一次性批准的输入依据。
                if(width!=Window.ClientSize.Width || height!=Window.ClientSize.Height) InteractionRevision++;
                bool visible = Convert.ToBoolean(b["visible"]) && width>0 && height>0;
                SetWindowPos(Window.Handle,IntPtr.Zero,Number(b,"x",0),Number(b,"y",0),width,height,0x0014);
                ShowWindow(Window.Handle,visible ? 4 : 0);
                Reply(id,true,null,null,null); return;
            }
            if (op == "probe") { Reply(id,true,null,null,Client.Connected == 1 ? "connected" : "disconnected"); return; }
            if (op == "disconnect") { if(Client.Connected != 0) Client.Disconnect(); Reply(id,true,null,null,"disconnected"); Window.Close(); return; }
            if (Client.Connected != 1) throw new InvalidOperationException("Remote desktop is not connected");
            if (op == "input") {
                if(!request.ContainsKey("interactionRevision") || Number(request,"interactionRevision",-1)!=InteractionRevision)
                    throw new InvalidOperationException("用户已经接管桌面，请基于新截图重新批准操作");
                var a=(Dictionary<string,object>)request["action"];
                string kind=Text(a,"kind");
                IntPtr target = IntPtr.Zero;
                EnumChildWindows(Control.Handle,(hwnd,data)=> {
                    var cls=new System.Text.StringBuilder(256); GetClassName(hwnd,cls,cls.Capacity);
                    if(cls.ToString()=="IHWindowClass") { target=hwnd; return false; } return true;
                },IntPtr.Zero);
                if(target==IntPtr.Zero) throw new InvalidOperationException("Remote input window is unavailable");
                if(kind=="click") {
                    int x=Number(a,"x",0),y=Number(a,"y",0);
                    if(x>=Control.Width || y>=Control.Height) throw new InvalidOperationException("Pointer outside desktop viewport");
                    var point=new IntPtr((y<<16)|(x&0xffff));
                    SendMessage(target,0x0200,IntPtr.Zero,point);
                    SendMessage(target,0x0201,new IntPtr(1),point); SendMessage(target,0x0202,IntPtr.Zero,point);
                } else if(kind=="key") {
                    int key=Number(a,"key",0);
                    int scan=(int)MapVirtualKey((uint)key,0);
                    SendMessage(target,0x0100,new IntPtr(key),new IntPtr(1|(scan<<16)));
                    SendMessage(target,0x0101,new IntPtr(key),new IntPtr(unchecked((int)0xc0000001)|(scan<<16)));
                } else if(kind=="text") {
                    foreach(char ch in Text(a,"text")) SendMessage(target,0x0102,new IntPtr(ch),new IntPtr(1));
                } else throw new InvalidOperationException("Unsupported desktop action");
                Reply(id,true,null,null,null); return;
            }
            if(op=="capture") {
                using(var bitmap=new Bitmap(Math.Max(1,Control.Width),Math.Max(1,Control.Height))) {
                    // 只抓取 RDP 子窗口，不能退回全屏截图而泄露用户本机界面。
                    using(var graphics=Graphics.FromImage(bitmap)) {
                        IntPtr dc=graphics.GetHdc();
                        try { if(!PrintWindow(Control.Handle,dc,1)) throw new InvalidOperationException("RDP capture unavailable"); }
                        finally { graphics.ReleaseHdc(dc); }
                    }
                    using(var buffer=new MemoryStream()) {
                        bitmap.Save(buffer,ImageFormat.Png);
                        Reply(id,true,null,"data:image/png;base64,"+Convert.ToBase64String(buffer.ToArray()),null);
                    }
                }
                return;
            }
            throw new InvalidOperationException("Unsupported operation");
        } catch(Exception error) { Reply(id,false,error.GetType().Name+": "+error.Message,null,null); }
    }
    [STAThread] static int Main(string[] args) {
        try {
            var type=Type.GetTypeFromProgID("MSTSCAX.MsTscAx.10",true);
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            Application.EnableVisualStyles();
            Window=new EmbeddedWindow { FormBorderStyle=FormBorderStyle.None, ShowInTaskbar=false, Width=1000, Height=700, AutoScaleMode=AutoScaleMode.None };
            Application.AddMessageFilter(new ManualInputFilter());
            Control=new RdpControl(type.GUID.ToString()); Control.Dock=DockStyle.Fill; Window.Controls.Add(Control);
            Window.CreateControl(); Control.CreateControl();
            IntPtr hwnd=Window.Handle;
            if(args.Length>0 && args[0]=="--probe") {
                var controlHandle=Control.Handle;
                dynamic probe=Control.Client;
                int connected=probe.Connected;
                Console.WriteLine("{\"available\":true}"); Window.Dispose(); return 0;
            }
            string first=Console.ReadLine();
            if(first==null) return 1;
            var init=Json.Deserialize<Dictionary<string,object>>(first);
            long parent=Convert.ToInt64(Text(init,"parent"),16);
            // Embed only inside the app window. No foreground/global keyboard injection.
            SetWindowLong(hwnd,-16,(GetWindowLong(hwnd,-16)&~unchecked((int)0x80000000))|0x40000000);
            SetLastError(0);
            if(SetParent(hwnd,new IntPtr(parent))==IntPtr.Zero && Marshal.GetLastWin32Error()!=0) throw new InvalidOperationException("RDP window embedding failed");
            Window.Show(); ShowWindow(hwnd,0); Client=Control.Client;
            Reply("ready",true,null,null,"ready");
            var reader=new Thread(()=> {
                string line;
                while((line=Console.ReadLine())!=null) {
                    try {
                        var request=Json.Deserialize<Dictionary<string,object>>(line);
                        Window.BeginInvoke((Action)(()=>Handle(request)));
                    } catch { Reply("invalid",false,"Invalid request",null,null); }
                }
                try { Window.BeginInvoke((Action)(()=>Window.Close())); } catch {}
            }); reader.IsBackground=true; reader.Start(); Application.Run(Window); return 0;
        } catch(Exception e) { Reply("ready",false,e.GetType().Name+": "+e.Message,null,null); return 1; }
    }
}
