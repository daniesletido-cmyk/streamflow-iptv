using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace StreamFlowLauncher
{
    static class Program
    {
        private const int Port = 3000;
        private const string LocalUrl = "http://localhost:3000";
        private const string CloudUrl = "https://streamflow-iptv-eta.vercel.app";

        [STAThread]
        static void Main()
        {
            Process serverProcess = null;

            try
            {
                // Check if local server is already running
                bool isLocalRunning = IsPortActive(Port);

                if (!isLocalRunning)
                {
                    serverProcess = StartLocalNodeServer();
                    for (int i = 0; i < 16; i++)
                    {
                        Thread.Sleep(200);
                        if (IsPortActive(Port))
                        {
                            isLocalRunning = true;
                            break;
                        }
                    }
                }

                string targetUrl = isLocalRunning ? LocalUrl : CloudUrl;
                Process browserProcess = LaunchAppWindow(targetUrl);

                if (browserProcess != null)
                {
                    browserProcess.WaitForExit();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error iniciando StreamFlow IPTV:\n" + ex.Message,
                    "StreamFlow IPTV",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    try { serverProcess.Kill(); } catch { }
                }
            }
        }

        private static bool IsPortActive(int port)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://localhost:" + port + "/api/info");
                request.Timeout = 800;
                request.Method = "GET";
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static Process StartLocalNodeServer()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string serverJs = Path.Combine(baseDir, "server.js");

                if (!File.Exists(serverJs))
                {
                    DirectoryInfo parent = Directory.GetParent(baseDir);
                    if (parent != null)
                    {
                        string parentServerJs = Path.Combine(parent.FullName, "server.js");
                        if (File.Exists(parentServerJs))
                        {
                            serverJs = parentServerJs;
                            baseDir = parent.FullName;
                        }
                    }
                }

                if (!File.Exists(serverJs)) return null;

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "\"" + serverJs + "\"",
                    WorkingDirectory = baseDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                return Process.Start(psi);
            }
            catch
            {
                return null;
            }
        }

        private static Process LaunchAppWindow(string url)
        {
            string[] possibleExecutables = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"BraveSoftware\Brave-Browser\Application\brave.exe")
            };

            string profileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StreamFlowIPTV",
                "Profile"
            );

            try { Directory.CreateDirectory(profileDir); } catch { }

            string appArgs = "--app=\"" + url + "\" " +
                             "--user-data-dir=\"" + profileDir + "\" " +
                             "--start-maximized " +
                             "--window-size=1366,768 " +
                             "--autoplay-policy=no-user-gesture-required " +
                             "--enable-gpu-rasterization " +
                             "--enable-zero-copy " +
                             "--ignore-gpu-blocklist " +
                             "--disable-background-networking " +
                             "--disable-default-apps " +
                             "--disable-extensions " +
                             "--disable-sync " +
                             "--no-first-run " +
                             "--disable-features=Translate";

            foreach (string exe in possibleExecutables)
            {
                if (File.Exists(exe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = exe,
                        Arguments = appArgs,
                        UseShellExecute = false
                    };
                    return Process.Start(psi);
                }
            }

            return Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
    }
}
