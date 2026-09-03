## Default Permission

The wallet's own native commands. Granted as one unit because the frontend needs all of
them or none: `src/lib/deviceAuth.ts` treats a missing command as "the feature is off",
so a partial grant would present a broken enrolment rather than an absent one.

#### This default permission set includes the following:

- `allow-auth-status`
- `allow-auth-store`
- `allow-auth-read`
- `allow-auth-delete`
- `allow-share-text`
- `allow-app-exit`
- `allow-exclude-from-backup`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`cosmos:allow-app-exit`

</td>
<td>

Enables the app_exit command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-app-exit`

</td>
<td>

Denies the app_exit command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:allow-auth-delete`

</td>
<td>

Enables the auth_delete command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-auth-delete`

</td>
<td>

Denies the auth_delete command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:allow-auth-read`

</td>
<td>

Enables the auth_read command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-auth-read`

</td>
<td>

Denies the auth_read command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:allow-auth-status`

</td>
<td>

Enables the auth_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-auth-status`

</td>
<td>

Denies the auth_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:allow-auth-store`

</td>
<td>

Enables the auth_store command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-auth-store`

</td>
<td>

Denies the auth_store command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:allow-exclude-from-backup`

</td>
<td>

Enables the exclude_from_backup command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-exclude-from-backup`

</td>
<td>

Denies the exclude_from_backup command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:allow-share-text`

</td>
<td>

Enables the share_text command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`cosmos:deny-share-text`

</td>
<td>

Denies the share_text command without any pre-configured scope.

</td>
</tr>
</table>
