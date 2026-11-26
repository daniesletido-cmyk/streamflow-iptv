using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace StreamFlowInstaller
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StreamFlowIPTV"
            );

            try
            {
                Directory.CreateDirectory(installDir);

                string exePath = Path.Combine(installDir, "StreamFlow-IPTV.exe");
                string icoPath = Path.Combine(installDir, "icon.ico");

                // 1. Extract embedded StreamFlow-IPTV.exe and icon.ico
                ExtractResource("StreamFlow-IPTV.exe", exePath);
                ExtractResource("icon.ico", icoPath);

                // 2. If running from project folder with server.js & public/, copy them for local mode
                string sourceDir = AppDomain.CurrentDomain.BaseDirectory;
                string localServer = Path.Combine(sourceDir, "server.js");
                if (File.Exists(localServer))
                {
                    File.Copy(localServer, Path.Combine(installDir, "server.js"), true);
                    string pkgJson = Path.Combine(sourceDir, "package.json");
                    if (File.Exists(pkgJson)) File.Copy(pkgJson, Path.Combine(installDir, "package.json"), true);

                    string publicSrc = Path.Combine(sourceDir, "public");
                    string publicDst = Path.Combine(installDir, "public");
                    if (Directory.Exists(publicSrc))
                    {
                        CopyDirectory(publicSrc, publicDst);
                    }
                    string nmSrc = Path.Combine(sourceDir, "node_modules");
                    string nmDst = Path.Combine(installDir, "node_modules");
                    if (Directory.Exists(nmSrc) && !Directory.Exists(nmDst))
                    {
                        // Create directory junction so we don't duplicate thousands of files on the same PC
                        RunHidden("cmd.exe", "/c mklink /J \"" + nmDst + "\" \"" + nmSrc + "\"");
                    }
                }

                // 3. Create Desktop & Start Menu shortcuts using PowerShell WScript.Shell
                string desktopShortcut = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "StreamFlow IPTV.lnk"
                );
                string startMenuDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                    "Programs"
                );
                string startMenuShortcut = Path.Combine(startMenuDir, "StreamFlow IPTV.lnk");

                CreateShortcut(desktopShortcut, exePath, installDir, icoPath, "StreamFlow IPTV - Televisión y Cine");
                CreateShortcut(startMenuShortcut, exePath, installDir, icoPath, "StreamFlow IPTV - Televisión y Cine");

                DialogResult res = MessageBox.Show(
                    "StreamFlow IPTV se ha instalado correctamente en este PC.\n\n" +
                    "• Se ha creado el acceso directo en el Escritorio.\n" +
                    "• Se ha añadido al Menú Inicio de Windows.\n\n" +
                    "¿Quieres abrir StreamFlow IPTV ahora?",
                    "Instalación completada — StreamFlow IPTV",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information
                );

                if (res == DialogResult.Yes)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        WorkingDirectory = installDir,
                        UseShellExecute = true
                    });
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error durante la instalación:\n" + ex.Message,
                    "Error — StreamFlow IPTV",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private static void ExtractResource(string resourceName, string outputPath)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream(resourceName))
            {
                if (s == null) throw new Exception("No se encontró el recurso interno: " + resourceName);
                using (FileStream fs = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
                {
                    s.CopyTo(fs);
                }
            }
        }

        private static void CopyDirectory(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                File.Copy(file, Path.Combine(destDir, Path.GetFileName(file)), true);
            }
            foreach (string dir in Directory.GetDirectories(sourceDir))
            {
                CopyDirectory(dir, Path.Combine(destDir, Path.GetFileName(dir)));
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string iconPath, string description)
        {
            string ps = "$ws = New-Object -ComObject WScript.Shell; " +
                        "$s = $ws.CreateShortcut('" + shortcutPath.Replace("'", "''") + "'); " +
                        "$s.TargetPath = '" + targetPath.Replace("'", "''") + "'; " +
                        "$s.WorkingDirectory = '" + workingDir.Replace("'", "''") + "'; " +
                        "$s.IconLocation = '" + iconPath.Replace("'", "''") + "'; " +
                        "$s.Description = '" + description.Replace("'", "''") + "'; " +
                        "$s.Save();";
            RunHidden("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \"" + ps + "\"");
        }

        private static void RunHidden(string fileName, string args)
        {
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = args,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process p = Process.Start(psi))
            {
                if (p != null) p.WaitForExit(5000);
            }
        }
    }
}
