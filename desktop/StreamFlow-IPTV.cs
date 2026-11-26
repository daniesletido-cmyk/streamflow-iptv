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
                    // Attempt to launch local node server silently
                    serverProcess = StartLocalNodeServer();
                    // Wait up to 4 seconds for server to start responding
                    for (int i = 0; i < 16; i++)
                    {
                        Thread.Sleep(250);
                        if (IsPortActive(Port))
                        {
                            isLocalRunning = true;
                            break;
                        }
                    }
                }

                string targetUrl = isLocalRunning ? LocalUrl : CloudUrl;

                // Launch in Standalone Chromium App Mode
                Process browserProcess = LaunchAppWindow(targetUrl);

                if (browserProcess != null)
                {
                    // Wait for user to close the app window
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
                // Cleanly kill server if we spawned it
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
                request.Timeout = 1000;
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
                    // Check parent dir if executable is inside bin/desktop
                    string parentServerJs = Path.Combine(Directory.GetParent(baseDir).FullName, "server.js");
                    if (File.Exists(parentServerJs))
                    {
                        serverJs = parentServerJs;
                        baseDir = Directory.GetParent(baseDir).FullName;
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

            string appArgs = "--app=\"" + url + "\" --start-maximized --window-size=1366,768 --disable-features=Translate";

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

            // Fallback to default system browser
            return Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
    }
}
