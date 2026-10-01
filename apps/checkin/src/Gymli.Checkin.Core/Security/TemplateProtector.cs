using System.Runtime.Versioning;
using System.Security.Cryptography;

namespace Gymli.Checkin.Core.Security;

/// <summary>
/// Encrypts fingerprint templates with AES-256-GCM (POPIA: biometric data is encrypted
/// at rest locally and in Firestore; the cloud only ever sees ciphertext).
/// The key lives on the check-in PC, protected by Windows DPAPI (machine scope).
/// Back it up with `Gymli.Checkin.App --export-key`; without it, members must re-enrol.
/// </summary>
public sealed class TemplateProtector
{
    private readonly byte[] _key;
    public string KeyId { get; }

    public TemplateProtector(byte[] key)
    {
        if (key.Length != 32) throw new ArgumentException("Key must be 32 bytes");
        _key = key;
        KeyId = Convert.ToHexString(SHA256.HashData(key))[..12].ToLowerInvariant();
    }

    public string Encrypt(byte[] plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return Convert.ToBase64String([1, .. nonce, .. tag, .. cipher]);
    }

    public byte[] Decrypt(string encoded)
    {
        var all = Convert.FromBase64String(encoded);
        if (all.Length < 29 || all[0] != 1) throw new CryptographicException("Unknown template format");
        var nonce = all.AsSpan(1, 12);
        var tag = all.AsSpan(13, 16);
        var cipher = all.AsSpan(29);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(_key, 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }

    /// <summary>Loads the key from the data folder, or makes a new one the first time.</summary>
    public static TemplateProtector LoadOrCreate(string dataFolder, string? importBase64 = null)
    {
        Directory.CreateDirectory(dataFolder);
        var path = Path.Combine(dataFolder, "template.key");
        if (importBase64 is { Length: > 0 })
        {
            var imported = Convert.FromBase64String(importBase64);
            File.WriteAllBytes(path, Protect(imported));
            return new TemplateProtector(imported);
        }
        if (File.Exists(path)) return new TemplateProtector(Unprotect(File.ReadAllBytes(path)));
        var key = RandomNumberGenerator.GetBytes(32);
        File.WriteAllBytes(path, Protect(key));
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        Log.Info("Created a new fingerprint template key. Back it up with --export-key.");
        return new TemplateProtector(key);
    }

    public static string Export(string dataFolder) =>
        Convert.ToBase64String(Unprotect(File.ReadAllBytes(Path.Combine(dataFolder, "template.key"))));

    private static byte[] Protect(byte[] key) => OperatingSystem.IsWindows() ? DpapiProtect(key) : key;
    private static byte[] Unprotect(byte[] stored) => OperatingSystem.IsWindows() ? DpapiUnprotect(stored) : stored;

    [SupportedOSPlatform("windows")]
    private static byte[] DpapiProtect(byte[] key) => ProtectedData.Protect(key, "gymli-templates"u8.ToArray(), DataProtectionScope.LocalMachine);

    [SupportedOSPlatform("windows")]
    private static byte[] DpapiUnprotect(byte[] stored) => ProtectedData.Unprotect(stored, "gymli-templates"u8.ToArray(), DataProtectionScope.LocalMachine);
}
