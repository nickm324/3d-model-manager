# Security

3D Model Manager is intended for trusted users on a private network. Optional local accounts provide administrator, editor, and read-only roles, but authentication is disabled until an administrator enables it.

Do not expose it directly to the public Internet. Use a VPN or an authenticated HTTPS reverse proxy if remote access is required. Keep NAS credentials out of the repository and protect the persistent app-data folder containing their encryption key.

Please use GitHub's private vulnerability reporting for security issues. Do not include credentials, private model files, internal addresses, or other sensitive data in a public issue.
