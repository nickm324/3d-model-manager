# Upgrading and recovery

## Before upgrading

Download a current backup from **Settings → Backup and recovery** and store it away from the Docker host. Keep the `/data` folder mounted at the same host path when replacing the container.

## Upgrade a local image

Extract the new release over a fresh project directory and run the included build test. In Portainer, redeploy the stack after the image succeeds:

```sh
sudo DATA_HOST_PATH=/srv/appdata/3d-model-manager ./build-and-test-on-omv.sh
```

Do not delete or recreate the host app-data folder. The application upgrades its saved metadata when it starts.

## Upgrade a GitHub Container Registry image

Pull the desired tag and redeploy the stack. Pin a version such as `2.2.0` when predictable upgrades are preferred; use `latest` to follow stable releases.

## Disaster recovery

1. Install a fresh container with an empty persistent `/data` folder.
2. Open the app and select **Settings → Backup and recovery → Restore backup**.
3. Choose the downloaded ZIP and enter its password if it was protected.
4. If the backup omitted SMB credentials, reconnect the network library.
5. Rescan and verify the model count, collections, covers, photos, activity history, and recycle bin.

Backup ZIPs protect application data. Back up the SMB model share separately because ordinary model files are not copied into metadata backups.

## Rollback

Stop the container, preserve `/data`, and redeploy the previously used image tag. Restore a backup created by that version if the older application cannot read newer metadata.
