using System.IO.Ports;
using Microsoft.Win32;

namespace Gymli.Checkin.Hardware.UsbRelay;

/// <summary>The PC's COM ports, marking Bluetooth ports (never a relay) and CH340 relay boards (USB 1A86:7523).</summary>
public static class SerialPorts
{
    public sealed record Port(string Name, bool Bluetooth, bool Ch340);

    public static IReadOnlyList<Port> List()
    {
        var names = SerialPort.GetPortNames().Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(p => p).ToList();
        var bluetooth = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ch340 = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var map = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DEVICEMAP\SERIALCOMM");
                foreach (var v in map?.GetValueNames() ?? [])
                    if (v.Contains("BthModem", StringComparison.OrdinalIgnoreCase) && map!.GetValue(v) is string port) bluetooth.Add(port);
            }
            catch { /* not readable: treat as unknown */ }
            try
            {
                using var usb = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\USB\VID_1A86&PID_7523");
                foreach (var inst in usb?.GetSubKeyNames() ?? [])
                {
                    using var p = usb!.OpenSubKey($@"{inst}\Device Parameters");
                    if (p?.GetValue("PortName") is string port) ch340.Add(port);
                }
            }
            catch { /* not readable: treat as unknown */ }
        }
        return names.Select(n => new Port(n, bluetooth.Contains(n), ch340.Contains(n))).ToList();
    }
}
