# Auto Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-user Vault bearer tokens with admin-managed enterprise credentials and run hourly background sync that updates inventory, surfaces untracked devices, and marks missing ones.

**Architecture:** Two new Django apps (`apps/enterprises`, `apps/notifications`) plus an `UntrackedDevice` model in `apps/devices`. APScheduler runs inside the Django process: hourly bulk ZedCloud poll + midnight digest email. The `Vault` app is removed entirely. Frontend gains a Clusters & Enterprises tab (read-only for members, full edit for admins), an Untracked Devices page, a revised Refresh modal (enterprise dropdown), and admin token-expiry notifications in the bell.

**Tech Stack:** Django 6.0, DRF 3.15, APScheduler 3.x, httpx 0.27, Fernet (cryptography 42), React 19, TanStack Query, TypeScript, shadcn/ui

## Global Constraints

- All views must declare `permission_classes` explicitly — default is `[]` (fully public)
- Use `get_user_email(request)` from `utils.permissions` — never `request.META.get('HTTP_X_USER_EMAIL')`
- Bearer tokens encrypted with `utils/crypto.py` `encrypt()`/`decrypt()` — never stored or returned as plaintext
- Use `utils/email.py` `_send()` wrapper — no-op if `EMAIL_HOST` blank; always catch + `logger.warning()`
- `UNAVAILABLE_CONDITIONS` defined in both `apps/devices/views.py` AND `apps/reservations/views.py` — keep in sync
- Frontend uses `src/api/client.ts` axios instance — never bare `fetch` or `axios`
- `missing` is already in `CONDITION_CHOICES` — no schema change needed for the condition field itself

---

## Task 1: Enterprise + Notification models

**Files:**
- Create: `backend/apps/enterprises/__init__.py`
- Create: `backend/apps/enterprises/apps.py`
- Create: `backend/apps/enterprises/models.py`
- Create: `backend/apps/enterprises/admin.py`
- Create: `backend/apps/enterprises/migrations/0001_initial.py` (via `makemigrations`)
- Create: `backend/apps/notifications/__init__.py`
- Create: `backend/apps/notifications/apps.py`
- Create: `backend/apps/notifications/models.py`
- Create: `backend/apps/notifications/admin.py`
- Create: `backend/apps/notifications/migrations/0001_initial.py` (via `makemigrations`)
- Modify: `backend/config/settings.py` (INSTALLED_APPS + APScheduler dep note)
- Modify: `backend/requirements.txt` (add apscheduler)

**Interfaces:**
- Produces: `Enterprise` model with fields `id, name, cluster(FK), bearer_token_enc, is_active, last_sync_at, last_sync_status, last_sync_error`
- Produces: `Notification` model with fields `id, kind, title, body, created_at, is_read, read_at`

- [ ] **Step 1: Create enterprise app skeleton**

```bash
cd backend
mkdir -p apps/enterprises
```

`backend/apps/enterprises/__init__.py` — empty file.

`backend/apps/enterprises/apps.py`:
```python
from django.apps import AppConfig

class EnterprisesConfig(AppConfig):
    name = 'apps.enterprises'
    default_auto_field = 'django.db.models.BigAutoField'
```

- [ ] **Step 2: Write Enterprise model**

`backend/apps/enterprises/models.py`:
```python
from django.db import models

SYNC_STATUS_CHOICES = [
    ('ok', 'OK'),
    ('error', 'Error'),
    ('token_expired', 'Token Expired'),
]


class Enterprise(models.Model):
    name = models.CharField(max_length=200)
    cluster = models.ForeignKey(
        'clusters.Cluster', on_delete=models.CASCADE, related_name='enterprises',
    )
    bearer_token_enc = models.BinaryField()
    is_active = models.BooleanField(default=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_sync_status = models.CharField(
        max_length=20, choices=SYNC_STATUS_CHOICES, null=True, blank=True,
    )
    last_sync_error = models.TextField(null=True, blank=True)

    class Meta:
        unique_together = ('name', 'cluster')
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.cluster.name})'
```

`backend/apps/enterprises/admin.py`:
```python
from django.contrib import admin
from .models import Enterprise


@admin.register(Enterprise)
class EnterpriseAdmin(admin.ModelAdmin):
    list_display = ('name', 'cluster', 'is_active', 'last_sync_status', 'last_sync_at')
    list_filter = ('is_active', 'last_sync_status', 'cluster')
    readonly_fields = ('bearer_token_enc', 'last_sync_at', 'last_sync_status', 'last_sync_error')
```

- [ ] **Step 3: Create notification app skeleton + model**

```bash
mkdir -p apps/notifications
```

`backend/apps/notifications/__init__.py` — empty.

`backend/apps/notifications/apps.py`:
```python
from django.apps import AppConfig

class NotificationsConfig(AppConfig):
    name = 'apps.notifications'
    default_auto_field = 'django.db.models.BigAutoField'
```

`backend/apps/notifications/models.py`:
```python
from django.db import models

KIND_CHOICES = [
    ('token_expired', 'Token Expired'),
    ('sync_error', 'Sync Error'),
]


class Notification(models.Model):
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    title = models.CharField(max_length=300)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title
```

`backend/apps/notifications/admin.py`:
```python
from django.contrib import admin
from .models import Notification

@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'is_read', 'created_at')
    list_filter = ('kind', 'is_read')
```

- [ ] **Step 4: Add apps to INSTALLED_APPS and APScheduler to requirements**

In `backend/config/settings.py`, add to `INSTALLED_APPS` after `'apps.vault'`:
```python
    'apps.enterprises',
    'apps.notifications',
```

In `backend/requirements.txt`, add:
```
apscheduler==3.*
```

- [ ] **Step 5: Generate and run migrations**

```bash
cd backend
python manage.py makemigrations enterprises notifications
python manage.py migrate
```

Expected: two new migration files created, migrations applied without errors.

- [ ] **Step 6: Verify models in Django shell**

```bash
python manage.py shell -c "
from apps.enterprises.models import Enterprise
from apps.notifications.models import Notification
print('Enterprise fields:', [f.name for f in Enterprise._meta.get_fields()])
print('Notification fields:', [f.name for f in Notification._meta.get_fields()])
print('OK')
"
```

Expected output includes `bearer_token_enc`, `last_sync_status`, `kind`, `is_read`.

- [ ] **Step 7: Commit** — pause and ask user for approval before committing.

```bash
git add backend/apps/enterprises/ backend/apps/notifications/ backend/config/settings.py backend/requirements.txt
git commit -m "feat: add Enterprise and Notification models"
```

---

## Task 2: Device model — enterprise FK + UntrackedDevice

**Files:**
- Modify: `backend/apps/devices/models.py`
- Create: `backend/apps/devices/migrations/000N_add_enterprise_fk_untracked_device.py` (via makemigrations)

**Interfaces:**
- Produces: `Device.enterprise` nullable FK to Enterprise (SET_NULL)
- Produces: `UntrackedDevice` model with serial/enterprise unique_together lookup

- [ ] **Step 1: Add enterprise FK to Device and UntrackedDevice model**

In `backend/apps/devices/models.py`, add after the `class Device` `cluster` FK line:
```python
    enterprise = models.ForeignKey(
        'enterprises.Enterprise', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='inventory_devices',
    )
```

Then append after the `Device` class definition:
```python

class UntrackedDevice(models.Model):
    enterprise = models.ForeignKey(
        'enterprises.Enterprise', on_delete=models.CASCADE, related_name='untracked_devices',
    )
    zcloud_id = models.CharField(max_length=200)
    name = models.CharField(max_length=200)
    serial_number = models.CharField(max_length=200)
    model = models.CharField(max_length=400, blank=True)
    run_state = models.CharField(max_length=100, blank=True)
    eve_version = models.CharField(max_length=200, blank=True, null=True)
    device_connectivity = models.JSONField(blank=True, null=True)
    first_seen_at = models.DateTimeField()
    last_seen_at = models.DateTimeField()

    class Meta:
        unique_together = ('serial_number', 'enterprise')
        ordering = ['-last_seen_at']

    def __str__(self):
        return f'{self.name} ({self.serial_number})'
```

- [ ] **Step 2: Makemigrations and migrate**

```bash
cd backend
python manage.py makemigrations devices
python manage.py migrate
```

Expected: new migration adds `enterprise` FK to `devices_device` and creates `devices_untrackeddevice` table.

- [ ] **Step 3: Verify**

```bash
python manage.py shell -c "
from apps.devices.models import Device, UntrackedDevice
print('Device has enterprise:', hasattr(Device, 'enterprise'))
print('UntrackedDevice fields:', [f.name for f in UntrackedDevice._meta.get_fields()])
"
```

- [ ] **Step 4: Commit** — pause and ask user for approval.

```bash
git add backend/apps/devices/models.py backend/apps/devices/migrations/
git commit -m "feat: add enterprise FK to Device and UntrackedDevice model"
```

---

## Task 3: ZedCloud bulk fetch + sync engine

**Files:**
- Modify: `backend/services/zedcloud.py`
- Create: `backend/apps/enterprises/sync.py`

**Interfaces:**
- Produces: `fetch_enterprise_devices(host: str, bearer_token: str) -> list[dict]`
- Produces: `sync_enterprise(enterprise) -> None` (single enterprise sync, raises on failure)
- Produces: `sync_all_enterprises() -> None` (called by APScheduler)

- [ ] **Step 1: Add `fetch_enterprise_devices` to zedcloud.py**

Append to `backend/services/zedcloud.py`:
```python

def fetch_enterprise_devices(host: str, bearer_token: str) -> list[dict]:
    """Paginate GET /v1/devices/status and return all device records."""
    headers = {'Authorization': f'Bearer {bearer_token}'}
    all_devices: list[dict] = []
    page_num = 1
    while True:
        url = f'https://{host}/v1/devices/status?next.pageSize=200&next.pageNum={page_num}'
        response = _client.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        all_devices.extend(data.get('list', []))
        total_pages = data.get('next', {}).get('totalPages', 1)
        if page_num >= total_pages:
            break
        page_num += 1
    return all_devices
```

- [ ] **Step 2: Write sync engine**

`backend/apps/enterprises/sync.py`:
```python
import logging
from django.utils import timezone
from utils.crypto import decrypt
from utils import email as email_utils
from services.zedcloud import fetch_enterprise_devices, STATUS_MAP
import httpx

logger = logging.getLogger(__name__)


def _extract_connectivity(net_status_list: list) -> list | None:
    connectivity = []
    for iface in net_status_list:
        if iface.get('up') and iface.get('uplink'):
            mac = iface.get('macAddr', '')
            iface_name = iface.get('ifName', '')
            for ip in iface.get('ipAddrs', []):
                if ip and ':' not in ip:
                    connectivity.append({'ip': ip, 'mac': mac, 'interface_name': iface_name})
    return connectivity or None


def _extract_eve_version(sw_info: list) -> str | None:
    return next(
        (sw['shortVersion'] for sw in sw_info if sw.get('activated')),
        None,
    )


def sync_enterprise(enterprise) -> set[str]:
    """Sync one enterprise. Returns set of seen serial numbers. Raises on failure."""
    from apps.devices.models import Device, UntrackedDevice
    from apps.notifications.models import Notification

    bearer_token = decrypt(bytes(enterprise.bearer_token_enc))
    raw_devices = fetch_enterprise_devices(enterprise.cluster.host, bearer_token)
    seen_serials: set[str] = set()
    now = timezone.now()

    for d in raw_devices:
        serial = d.get('minfo', {}).get('serialNumber', '')
        if not serial:
            continue

        seen_serials.add(serial)
        run_state = d.get('runState', 'RUN_STATE_UNKNOWN')
        status_str = STATUS_MAP.get(run_state, 'Unknown')
        eve_version = _extract_eve_version(d.get('swInfo', []))
        connectivity = _extract_connectivity(d.get('netStatusList', []))
        minfo = d.get('minfo', {})
        model_str = f"{minfo.get('manufacturer', '')}-{minfo.get('productName', '')}".strip('-')
        device_name = d.get('name', '')
        zcloud_id = d.get('id', '')

        inventory_device = Device.objects.filter(serial_number=serial).first()
        if inventory_device:
            update_fields = [
                'enterprise', 'cluster', 'cluster_device_name',
                'eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'updated_at',
            ]
            inventory_device.enterprise = enterprise
            inventory_device.cluster = enterprise.cluster
            inventory_device.cluster_device_name = device_name
            inventory_device.eve_version = eve_version
            inventory_device.device_connectivity = connectivity
            inventory_device.status = status_str
            inventory_device.status_fetched_at = now
            if inventory_device.condition == 'missing':
                inventory_device.condition = 'normal'
                update_fields.append('condition')
            inventory_device.save(update_fields=update_fields)
        else:
            obj, created = UntrackedDevice.objects.update_or_create(
                serial_number=serial,
                enterprise=enterprise,
                defaults={
                    'zcloud_id': zcloud_id,
                    'name': device_name,
                    'model': model_str,
                    'run_state': run_state,
                    'eve_version': eve_version,
                    'device_connectivity': connectivity,
                    'last_seen_at': now,
                },
            )
            if created:
                obj.first_seen_at = now
                obj.save(update_fields=['first_seen_at'])

    return seen_serials


def sync_all_enterprises() -> None:
    from apps.enterprises.models import Enterprise
    from apps.devices.models import Device
    from apps.notifications.models import Notification

    logger.info('Starting sync_all_enterprises')
    all_seen_serials: set[str] = set()

    for enterprise in Enterprise.objects.filter(is_active=True).select_related('cluster'):
        try:
            seen = sync_enterprise(enterprise)
            all_seen_serials.update(seen)
            enterprise.last_sync_status = 'ok'
            enterprise.last_sync_error = None
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code in (401, 403):
                enterprise.last_sync_status = 'token_expired'
                enterprise.last_sync_error = f'HTTP {code}'
                email_utils.send_token_expiry_alert(enterprise)
                Notification.objects.create(
                    kind='token_expired',
                    title=f'Token expired — {enterprise.name} on {enterprise.cluster.name}',
                    body=(
                        f'Bearer token for enterprise "{enterprise.name}" on cluster '
                        f'"{enterprise.cluster.name}" ({enterprise.cluster.host}) is invalid or expired. '
                        f'Update it in the Clusters & Enterprises tab.'
                    ),
                )
            else:
                enterprise.last_sync_status = 'error'
                enterprise.last_sync_error = f'HTTP {code}'
            logger.warning('ZedCloud HTTP %s for enterprise %s', code, enterprise.name)
        except Exception as exc:
            enterprise.last_sync_status = 'error'
            enterprise.last_sync_error = str(exc)
            logger.exception('Sync failed for enterprise %s', enterprise.name)
        finally:
            enterprise.last_sync_at = timezone.now()
            enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])

    # Mark MISSING: inventory devices with enterprise assigned, condition=normal, not seen this cycle
    Device.objects.filter(
        enterprise__isnull=False,
        condition='normal',
    ).exclude(serial_number__in=all_seen_serials).update(condition='missing')

    logger.info('sync_all_enterprises complete. Seen serials: %d', len(all_seen_serials))
```

- [ ] **Step 3: Verify imports resolve**

```bash
cd backend
python manage.py shell -c "
from apps.enterprises.sync import sync_all_enterprises, sync_enterprise
from services.zedcloud import fetch_enterprise_devices
print('imports OK')
"
```

- [ ] **Step 4: Commit** — pause and ask user for approval.

```bash
git add backend/services/zedcloud.py backend/apps/enterprises/sync.py
git commit -m "feat: add bulk ZedCloud fetch and enterprise sync engine"
```

---

## Task 4: Email additions + APScheduler registration

**Files:**
- Modify: `backend/utils/email.py`
- Modify: `backend/apps/enterprises/apps.py`

**Interfaces:**
- Produces: `send_token_expiry_alert(enterprise)` — immediate email to admins
- Produces: `send_nightly_digest()` — midnight email to admins
- Produces: APScheduler started in `EnterprisesConfig.ready()`

- [ ] **Step 1: Add email functions to utils/email.py**

Append to `backend/utils/email.py`:
```python


def send_token_expiry_alert(enterprise):
    from django.utils import timezone
    admin_emails = list(
        PortalUser.objects.filter(user_type='admin').values_list('email', flat=True)
    )
    subject = f'[Holocron] Token expired — {enterprise.name} on {enterprise.cluster.name}'
    body = (
        f'The bearer token for enterprise "{enterprise.name}" on cluster '
        f'"{enterprise.cluster.name}" ({enterprise.cluster.host}) is invalid or expired.\n\n'
        f'Failure detected at: {timezone.now().strftime("%Y-%m-%d %H:%M UTC")}\n\n'
        f'Update the token in the Clusters & Enterprises tab.'
    )
    _send(subject, body, admin_emails)


def send_nightly_digest():
    from apps.devices.models import Device
    from apps.enterprises.models import Enterprise
    admin_emails = list(
        PortalUser.objects.filter(user_type='admin').values_list('email', flat=True)
    )
    if not admin_emails:
        return

    missing_devices = list(Device.objects.filter(condition='missing').select_related('cluster', 'enterprise'))
    out_of_order_devices = list(Device.objects.filter(condition='out_of_order'))
    problem_enterprises = list(
        Enterprise.objects.filter(last_sync_status__in=['error', 'token_expired']).select_related('cluster')
    )

    if not missing_devices and not out_of_order_devices and not problem_enterprises:
        return

    lines = ['[Holocron] Nightly Digest\n']

    if missing_devices:
        lines.append(f'--- Missing Devices ({len(missing_devices)}) ---')
        for d in missing_devices:
            cluster = d.cluster.name if d.cluster else '—'
            ent = d.enterprise.name if d.enterprise else '—'
            lines.append(f'  {d.name}  serial={d.serial_number}  cluster={cluster}  enterprise={ent}')
        lines.append('')

    if out_of_order_devices:
        lines.append(f'--- Out of Order Devices ({len(out_of_order_devices)}) ---')
        for d in out_of_order_devices:
            lines.append(f'  {d.name}  serial={d.serial_number}')
        lines.append('')

    if problem_enterprises:
        lines.append(f'--- Enterprises with Errors ({len(problem_enterprises)}) ---')
        for e in problem_enterprises:
            lines.append(f'  {e.name} on {e.cluster.name}  status={e.last_sync_status}  error={e.last_sync_error or "—"}')
        lines.append('')

    _send('[Holocron] Nightly Digest', '\n'.join(lines), admin_emails)
```

- [ ] **Step 2: Register APScheduler in EnterprisesConfig.ready()**

Replace `backend/apps/enterprises/apps.py` with:
```python
import sys
import os
from django.apps import AppConfig


class EnterprisesConfig(AppConfig):
    name = 'apps.enterprises'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        # In Django dev server: the reloader process spawns a child with RUN_MAIN=true.
        # Only start the scheduler in the child (or in production where sys.argv has no 'runserver').
        if 'runserver' in sys.argv and os.environ.get('RUN_MAIN') != 'true':
            return
        self._start_scheduler()

    def _start_scheduler(self):
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.interval import IntervalTrigger
            from apscheduler.triggers.cron import CronTrigger
            from apps.enterprises.sync import sync_all_enterprises
            from utils.email import send_nightly_digest

            scheduler = BackgroundScheduler(timezone='UTC')
            scheduler.add_job(
                sync_all_enterprises,
                trigger=IntervalTrigger(hours=1),
                id='sync_enterprises',
                replace_existing=True,
                max_instances=1,
                misfire_grace_time=300,
            )
            scheduler.add_job(
                send_nightly_digest,
                trigger=CronTrigger(hour=0, minute=0, timezone='UTC'),
                id='nightly_digest',
                replace_existing=True,
                max_instances=1,
            )
            scheduler.start()
            import logging
            logging.getLogger(__name__).info('APScheduler started (sync every 1h, digest at midnight UTC)')
        except Exception as exc:
            import logging
            logging.getLogger(__name__).exception('Failed to start APScheduler: %s', exc)
```

- [ ] **Step 3: Verify server starts without error**

```bash
cd backend
python manage.py check
```

Expected: `System check identified no issues`.

- [ ] **Step 4: Commit** — pause and ask user for approval.

```bash
git add backend/utils/email.py backend/apps/enterprises/apps.py
git commit -m "feat: add token-expiry email, nightly digest, and APScheduler registration"
```

---

## Task 5: Enterprise + Cluster CRUD API

**Files:**
- Create: `backend/apps/enterprises/serializers.py`
- Create: `backend/apps/enterprises/views.py`
- Create: `backend/apps/enterprises/urls.py`
- Modify: `backend/apps/clusters/serializers.py`
- Modify: `backend/apps/clusters/views.py`
- Modify: `backend/apps/clusters/urls.py`
- Modify: `backend/config/urls.py`

**Interfaces:**
- `GET /api/v1/clusters/` → clusters with nested enterprises (no bearer_token in response)
- `POST /api/v1/clusters/` → create cluster
- `PATCH /api/v1/clusters/{id}/` → update cluster
- `DELETE /api/v1/clusters/{id}/` → delete (blocked if enterprises exist)
- `POST /api/v1/clusters/{id}/enterprises/` → add enterprise (bearer_token required, immediately encrypted)
- `PATCH /api/v1/enterprises/{id}/` → update name/token
- `DELETE /api/v1/enterprises/{id}/` → delete enterprise
- `POST /api/v1/enterprises/{id}/sync/` → trigger immediate sync

- [ ] **Step 1: Write enterprise serializers**

`backend/apps/enterprises/serializers.py`:
```python
from rest_framework import serializers
from .models import Enterprise
from utils.crypto import encrypt


class EnterpriseReadSerializer(serializers.ModelSerializer):
    cluster_name = serializers.CharField(source='cluster.name', read_only=True)

    class Meta:
        model = Enterprise
        fields = [
            'id', 'name', 'cluster', 'cluster_name',
            'is_active', 'last_sync_at', 'last_sync_status', 'last_sync_error',
        ]


class EnterpriseCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    bearer_token = serializers.CharField(write_only=True)
    is_active = serializers.BooleanField(default=True)

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name must not be blank.')
        return value.strip()

    def validate_bearer_token(self, value):
        if not value.strip():
            raise serializers.ValidationError('Bearer token must not be blank.')
        return value.strip()

    def create(self, validated_data):
        cluster = self.context['cluster']
        bearer_token = validated_data.pop('bearer_token')
        return Enterprise.objects.create(
            cluster=cluster,
            bearer_token_enc=encrypt(bearer_token),
            **validated_data,
        )


class EnterpriseUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    bearer_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name must not be blank.')
        return value.strip()

    def update(self, instance, validated_data):
        bearer_token = validated_data.pop('bearer_token', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        if bearer_token and bearer_token.strip():
            instance.bearer_token_enc = encrypt(bearer_token.strip())
        instance.save()
        return instance
```

- [ ] **Step 2: Write enterprise views**

`backend/apps/enterprises/views.py`:
```python
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Enterprise
from .serializers import EnterpriseReadSerializer, EnterpriseCreateSerializer, EnterpriseUpdateSerializer
from .sync import sync_enterprise
from utils.permissions import IsAdminPortalUser
import httpx

logger = logging.getLogger(__name__)


class EnterpriseDetailView(APIView):
    permission_classes = [IsAdminPortalUser]

    def _get(self, pk):
        try:
            return Enterprise.objects.select_related('cluster').get(pk=pk)
        except Enterprise.DoesNotExist:
            return None

    def patch(self, request, pk):
        enterprise = self._get(pk)
        if not enterprise:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = EnterpriseUpdateSerializer(enterprise, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(EnterpriseReadSerializer(enterprise).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        enterprise = self._get(pk)
        if not enterprise:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        enterprise.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EnterpriseSyncView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            enterprise = Enterprise.objects.select_related('cluster').get(pk=pk)
        except Enterprise.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        try:
            sync_enterprise(enterprise)
            enterprise.last_sync_status = 'ok'
            enterprise.last_sync_error = None
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            enterprise.last_sync_status = 'token_expired' if code in (401, 403) else 'error'
            enterprise.last_sync_error = f'HTTP {code}'
        except Exception as exc:
            enterprise.last_sync_status = 'error'
            enterprise.last_sync_error = str(exc)
        from django.utils import timezone
        enterprise.last_sync_at = timezone.now()
        enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])
        return Response(EnterpriseReadSerializer(enterprise).data)
```

- [ ] **Step 3: Write enterprise URLs**

`backend/apps/enterprises/urls.py`:
```python
from django.urls import path
from .views import EnterpriseDetailView, EnterpriseSyncView

urlpatterns = [
    path('<int:pk>/', EnterpriseDetailView.as_view()),
    path('<int:pk>/sync/', EnterpriseSyncView.as_view()),
]
```

- [ ] **Step 4: Extend cluster serializer with nested enterprises**

Replace `backend/apps/clusters/serializers.py` with:
```python
import re
from rest_framework import serializers
from .models import Cluster
from apps.enterprises.serializers import EnterpriseReadSerializer, EnterpriseCreateSerializer

_HOST_RE = re.compile(r'^zcloud\.[a-z0-9][a-z0-9-]*\.zededa\.(net|dev)$')


class ClusterSerializer(serializers.ModelSerializer):
    enterprises = EnterpriseReadSerializer(many=True, read_only=True)

    class Meta:
        model = Cluster
        fields = ['id', 'name', 'host', 'enterprises']

    def validate_name(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Cluster name must not be blank.')
        return value.strip()

    def validate_host(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Host is required.')
        if not _HOST_RE.match(value.strip()):
            raise serializers.ValidationError(
                'Host must follow the format: zcloud.<name>.zededa.net or zcloud.<name>.zededa.dev'
            )
        return value.strip()
```

- [ ] **Step 5: Extend cluster views with PATCH/DELETE and nested enterprise creation**

Replace `backend/apps/clusters/views.py` with:
```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Cluster
from .serializers import ClusterSerializer
from apps.enterprises.serializers import EnterpriseCreateSerializer, EnterpriseReadSerializer
from utils.permissions import IsPortalUser, IsAdminPortalUser


class ClusterListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsPortalUser()]
        return [IsAdminPortalUser()]

    def get(self, request):
        clusters = Cluster.objects.prefetch_related('enterprises__cluster').order_by('name')
        serializer = ClusterSerializer(clusters, many=True)
        return Response(serializer.data)

    def post(self, request):
        data = request.data.copy()
        if 'host' not in data or not data['host']:
            name = data.get('name', '').lower().strip()
            data['host'] = f'zcloud.{name}.zededa.net'
        serializer = ClusterSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ClusterDetailView(APIView):
    permission_classes = [IsAdminPortalUser]

    def _get(self, pk):
        try:
            return Cluster.objects.prefetch_related('enterprises').get(pk=pk)
        except Cluster.DoesNotExist:
            return None

    def patch(self, request, pk):
        cluster = self._get(pk)
        if not cluster:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ClusterSerializer(cluster, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(ClusterSerializer(cluster).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        cluster = self._get(pk)
        if not cluster:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if cluster.enterprises.exists():
            return Response(
                {'error': 'Cannot delete cluster with enterprises. Remove enterprises first.'},
                status=status.HTTP_409_CONFLICT,
            )
        cluster.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClusterEnterpriseListCreateView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            cluster = Cluster.objects.get(pk=pk)
        except Cluster.DoesNotExist:
            return Response({'error': 'Cluster not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = EnterpriseCreateSerializer(data=request.data, context={'cluster': cluster})
        if serializer.is_valid():
            enterprise = serializer.save()
            return Response(EnterpriseReadSerializer(enterprise).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
```

- [ ] **Step 6: Update cluster and root URLs**

Replace `backend/apps/clusters/urls.py`:
```python
from django.urls import path
from .views import ClusterListCreateView, ClusterDetailView, ClusterEnterpriseListCreateView

urlpatterns = [
    path('', ClusterListCreateView.as_view()),
    path('<int:pk>/', ClusterDetailView.as_view()),
    path('<int:pk>/enterprises/', ClusterEnterpriseListCreateView.as_view()),
]
```

In `backend/config/urls.py`, add after the clusters include line:
```python
    path('api/v1/enterprises/', include('apps.enterprises.urls')),
    path('api/v1/notifications/', include('apps.notifications.urls')),
```

- [ ] **Step 7: Smoke-test endpoints**

```bash
cd backend && python manage.py runserver &
sleep 2
curl -s -X GET http://localhost:8000/api/v1/clusters/ -H "X-User-Email: varuna@zededa.com" | python -m json.tool
kill %1
```

Expected: JSON list of clusters, each with `enterprises: []`.

- [ ] **Step 8: Commit** — pause and ask user for approval.

```bash
git add backend/apps/enterprises/ backend/apps/clusters/ backend/config/urls.py
git commit -m "feat: enterprise + cluster CRUD API with nested enterprises"
```

---

## Task 6: Cluster config import/export

**Files:**
- Modify: `backend/apps/enterprises/views.py`
- Modify: `backend/apps/enterprises/urls.py`

**Interfaces:**
- `GET /api/v1/clusters/export/` → JSON download, bearer tokens excluded
- `POST /api/v1/clusters/import/` → body: JSON array + `on_conflict: "overwrite"|"skip"`

- [ ] **Step 1: Add export view to enterprises/views.py**

Append to `backend/apps/enterprises/views.py`:
```python

import json
from django.http import HttpResponse
from apps.clusters.models import Cluster


class ClusterExportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):
        clusters = Cluster.objects.prefetch_related('enterprises').order_by('name')
        payload = []
        for cluster in clusters:
            payload.append({
                'cluster_name': cluster.name,
                'cluster_host': cluster.host,
                'enterprises': [{'name': e.name} for e in cluster.enterprises.all()],
            })
        content = json.dumps(payload, indent=2)
        response = HttpResponse(content, content_type='application/json')
        response['Content-Disposition'] = 'attachment; filename="cluster-config.json"'
        return response


class ClusterImportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request):
        on_conflict = request.data.get('on_conflict', 'skip')
        if on_conflict not in ('overwrite', 'skip'):
            return Response(
                {'error': 'on_conflict must be "overwrite" or "skip"'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw = request.data.get('config')
        if raw is None:
            return Response({'error': 'config field is required'}, status=status.HTTP_400_BAD_REQUEST)

        if isinstance(raw, str):
            try:
                config = json.loads(raw)
            except json.JSONDecodeError as exc:
                return Response({'error': f'Invalid JSON: {exc}'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            config = raw

        if not isinstance(config, list):
            return Response({'error': 'config must be a JSON array'}, status=status.HTTP_400_BAD_REQUEST)

        errors = []
        created_clusters = 0
        created_enterprises = 0
        updated_enterprises = 0
        skipped_enterprises = 0

        for entry in config:
            cluster_host = (entry.get('cluster_host') or '').strip()
            cluster_name = (entry.get('cluster_name') or '').strip()
            enterprises_data = entry.get('enterprises', [])

            if not cluster_host:
                errors.append(f'Entry missing cluster_host: {entry}')
                continue

            cluster, c_created = Cluster.objects.get_or_create(
                host=cluster_host,
                defaults={'name': cluster_name or cluster_host},
            )
            if c_created:
                created_clusters += 1

            for ent in enterprises_data:
                ent_name = (ent.get('name') or '').strip()
                bearer_token = (ent.get('bearer_token') or '').strip()

                if not ent_name:
                    errors.append(f'Enterprise entry missing name in cluster {cluster_host}')
                    continue
                if not bearer_token:
                    errors.append(f'Missing bearer_token for enterprise "{ent_name}" in cluster {cluster_host}')
                    continue

                existing = Enterprise.objects.filter(name=ent_name, cluster=cluster).first()
                if existing:
                    if on_conflict == 'overwrite':
                        existing.bearer_token_enc = encrypt(bearer_token)
                        existing.save(update_fields=['bearer_token_enc'])
                        updated_enterprises += 1
                    else:
                        skipped_enterprises += 1
                else:
                    Enterprise.objects.create(
                        name=ent_name,
                        cluster=cluster,
                        bearer_token_enc=encrypt(bearer_token),
                    )
                    created_enterprises += 1

        result = {
            'created_clusters': created_clusters,
            'created_enterprises': created_enterprises,
            'updated_enterprises': updated_enterprises,
            'skipped_enterprises': skipped_enterprises,
        }
        if errors:
            result['errors'] = errors
            return Response(result, status=status.HTTP_207_MULTI_STATUS)
        return Response(result, status=status.HTTP_200_OK)
```

Add `encrypt` to the import at the top of `views.py`:
```python
from utils.crypto import encrypt
```

- [ ] **Step 2: Add export/import URLs to clusters urls (not enterprises)**

In `backend/apps/clusters/urls.py`, add:
```python
from apps.enterprises.views import ClusterExportView, ClusterImportView

urlpatterns = [
    path('', ClusterListCreateView.as_view()),
    path('export/', ClusterExportView.as_view()),
    path('import/', ClusterImportView.as_view()),
    path('<int:pk>/', ClusterDetailView.as_view()),
    path('<int:pk>/enterprises/', ClusterEnterpriseListCreateView.as_view()),
]
```

- [ ] **Step 3: Verify export returns valid JSON**

```bash
cd backend && python manage.py runserver &
sleep 2
curl -s http://localhost:8000/api/v1/clusters/export/ -H "X-User-Email: varuna@zededa.com"
kill %1
```

Expected: JSON array (possibly empty if no clusters).

- [ ] **Step 4: Commit** — pause and ask user for approval.

```bash
git add backend/apps/enterprises/views.py backend/apps/clusters/urls.py
git commit -m "feat: cluster config import/export endpoints"
```

---

## Task 7: Untracked devices API

**Files:**
- Modify: `backend/apps/devices/serializers.py`
- Modify: `backend/apps/devices/views.py`
- Modify: `backend/apps/devices/urls.py`

**Interfaces:**
- `GET /api/v1/untracked-devices/?enterprise=&cluster=&serial_number=` → paginated list
- `POST /api/v1/untracked-devices/{id}/move-to-inventory/` → creates Device, deletes UntrackedDevice

- [ ] **Step 1: Add UntrackedDevice serializer**

Append to `backend/apps/devices/serializers.py`:
```python

from .models import UntrackedDevice


class UntrackedDeviceSerializer(serializers.ModelSerializer):
    enterprise_name = serializers.CharField(source='enterprise.name', read_only=True)
    cluster_name = serializers.CharField(source='enterprise.cluster.name', read_only=True)
    cluster_host = serializers.CharField(source='enterprise.cluster.host', read_only=True)

    class Meta:
        model = UntrackedDevice
        fields = [
            'id', 'enterprise', 'enterprise_name', 'cluster_name', 'cluster_host',
            'zcloud_id', 'name', 'serial_number', 'model',
            'run_state', 'eve_version', 'device_connectivity',
            'first_seen_at', 'last_seen_at',
        ]
```

- [ ] **Step 2: Add untracked device views**

Append to `backend/apps/devices/views.py` (after existing imports, add `UntrackedDevice` to the devices import, then add views):

First update the import at line 13:
```python
from .models import Device, Lab, CONDITION_CHOICES, UntrackedDevice
```

Then add to existing serializer imports in views.py line 14:
```python
from .serializers import DeviceSerializer, DeviceCreateSerializer, UntrackedDeviceSerializer
```

Then append the new view classes at the end of `views.py`:
```python


class UntrackedDeviceListView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        qs = UntrackedDevice.objects.select_related('enterprise__cluster').all()
        enterprise = request.query_params.get('enterprise', '').strip()
        cluster = request.query_params.get('cluster', '').strip()
        serial = request.query_params.get('serial_number', '').strip()
        if enterprise:
            qs = qs.filter(enterprise__name__icontains=enterprise)
        if cluster:
            qs = qs.filter(enterprise__cluster__name__icontains=cluster)
        if serial:
            qs = qs.filter(serial_number__icontains=serial)
        serializer = UntrackedDeviceSerializer(qs[:200], many=True)
        return Response(serializer.data)


class MoveToInventoryView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request, pk):
        try:
            untracked = UntrackedDevice.objects.select_related('enterprise__cluster').get(pk=pk)
        except UntrackedDevice.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if Device.objects.filter(serial_number=untracked.serial_number).exists():
            return Response(
                {'error': f'Device with serial {untracked.serial_number!r} already exists in inventory'},
                status=status.HTTP_409_CONFLICT,
            )

        lab_name = request.data.get('lab', '')
        if not lab_name:
            return Response({'error': 'lab is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            lab = Lab.objects.get(name=lab_name)
        except Lab.DoesNotExist:
            return Response({'error': f'Lab {lab_name!r} not found'}, status=status.HTTP_400_BAD_REQUEST)

        model_obj = None
        model_id = request.data.get('model')
        if model_id:
            try:
                from apps.device_models.models import DeviceModel
                model_obj = DeviceModel.objects.get(pk=model_id)
            except Exception:
                pass

        if not model_obj:
            return Response({'error': 'model (device model id) is required'}, status=status.HTTP_400_BAD_REQUEST)

        from services.zedcloud import STATUS_MAP
        run_state = untracked.run_state or 'RUN_STATE_UNKNOWN'
        status_str = STATUS_MAP.get(run_state, 'Unknown')

        with transaction.atomic():
            device = Device.objects.create(
                name=untracked.name,
                serial_number=untracked.serial_number,
                model=model_obj,
                lab=lab,
                enterprise=untracked.enterprise,
                cluster=untracked.enterprise.cluster,
                cluster_device_name=untracked.name,
                eve_version=untracked.eve_version,
                device_connectivity=untracked.device_connectivity,
                status=status_str,
                status_fetched_at=untracked.last_seen_at,
            )
            user_email = get_user_email(request)
            OwnershipHistory.objects.create(
                device=device,
                owner_email=None,
                changed_by=user_email or 'system',
                reason='device_added',
            )
            untracked.delete()

        return Response(DeviceSerializer(device).data, status=status.HTTP_201_CREATED)
```

- [ ] **Step 3: Add URLs for untracked devices**

In `backend/apps/devices/urls.py`, add imports and paths:
```python
from .views import (
    DeviceListCreateView,
    DeviceDetailView,
    DeviceReserveView,
    DeviceForceAssignView,
    DeviceReleaseView,
    DeviceStatusView,
    DevicePurposeView,
    DeviceOwnershipHistoryView,
    UntrackedDeviceListView,
    MoveToInventoryView,
)

urlpatterns = [
    path('', DeviceListCreateView.as_view()),
    path('<int:pk>/', DeviceDetailView.as_view()),
    path('<int:pk>/reserve/', DeviceReserveView.as_view()),
    path('<int:pk>/force-assign/', DeviceForceAssignView.as_view()),
    path('<int:pk>/release/', DeviceReleaseView.as_view()),
    path('<int:pk>/status/', DeviceStatusView.as_view()),
    path('<int:pk>/purpose/', DevicePurposeView.as_view()),
    path('<int:pk>/ownership-history/', DeviceOwnershipHistoryView.as_view()),
]
```

In `backend/config/urls.py`, add:
```python
    path('api/v1/untracked-devices/', include('apps.devices.untracked_urls')),
```

Create `backend/apps/devices/untracked_urls.py`:
```python
from django.urls import path
from .views import UntrackedDeviceListView, MoveToInventoryView

urlpatterns = [
    path('', UntrackedDeviceListView.as_view()),
    path('<int:pk>/move-to-inventory/', MoveToInventoryView.as_view()),
]
```

- [ ] **Step 4: Run check**

```bash
cd backend && python manage.py check
```

Expected: no errors.

- [ ] **Step 5: Commit** — pause and ask user for approval.

```bash
git add backend/apps/devices/
git commit -m "feat: untracked devices list and move-to-inventory API"
```

---

## Task 8: Notification API

**Files:**
- Create: `backend/apps/notifications/serializers.py`
- Create: `backend/apps/notifications/views.py`
- Create: `backend/apps/notifications/urls.py`

**Interfaces:**
- `GET /api/v1/notifications/` → newest first, admin only
- `POST /api/v1/notifications/{id}/read/` → mark one read
- `POST /api/v1/notifications/read-all/` → mark all read

- [ ] **Step 1: Write notification serializer**

`backend/apps/notifications/serializers.py`:
```python
from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'kind', 'title', 'body', 'created_at', 'is_read', 'read_at']
        read_only_fields = ['created_at', 'read_at']
```

- [ ] **Step 2: Write notification views**

`backend/apps/notifications/views.py`:
```python
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Notification
from .serializers import NotificationSerializer
from utils.permissions import IsAdminPortalUser


class NotificationListView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):
        qs = Notification.objects.all()[:50]
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationReadView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            n = Notification.objects.get(pk=pk)
        except Notification.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if not n.is_read:
            n.is_read = True
            n.read_at = timezone.now()
            n.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(n).data)


class NotificationReadAllView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request):
        now = timezone.now()
        Notification.objects.filter(is_read=False).update(is_read=True, read_at=now)
        return Response({'ok': True})
```

- [ ] **Step 3: Write notification URLs**

`backend/apps/notifications/urls.py`:
```python
from django.urls import path
from .views import NotificationListView, NotificationReadView, NotificationReadAllView

urlpatterns = [
    path('', NotificationListView.as_view()),
    path('read-all/', NotificationReadAllView.as_view()),
    path('<int:pk>/read/', NotificationReadView.as_view()),
]
```

- [ ] **Step 4: Run check**

```bash
cd backend && python manage.py check
```

- [ ] **Step 5: Commit** — pause and ask user for approval.

```bash
git add backend/apps/notifications/
git commit -m "feat: notification list and mark-read API"
```

---

## Task 9: Revised device status API + choices extension + Vault removal

**Files:**
- Modify: `backend/apps/devices/views.py` (DeviceStatusView, ChoicesView)
- Modify: `backend/config/urls.py` (remove vault, verify notification/enterprise routes present)
- Modify: `backend/config/settings.py` (remove vault from INSTALLED_APPS)

**Interfaces:**
- `POST /api/v1/devices/{id}/status/` now accepts `enterprise_id` (int, optional)
- `GET /api/v1/choices/` now returns `enterprises: [{id, name, cluster_name}]`
- Vault endpoints removed

- [ ] **Step 1: Replace DeviceStatusView**

In `backend/apps/devices/views.py`:

Remove the Vault import at line 20: `from apps.vault.models import Vault`

Replace the `DeviceStatusView` class (lines 352-438) with:
```python
class DeviceStatusView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request, pk):
        try:
            device = Device.objects.select_related('cluster', 'enterprise__cluster').get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        enterprise_id = request.data.get('enterprise_id')

        if enterprise_id:
            try:
                from apps.enterprises.models import Enterprise
                enterprise = Enterprise.objects.select_related('cluster').get(pk=enterprise_id)
            except Enterprise.DoesNotExist:
                return Response({'error': 'Enterprise not found'}, status=status.HTTP_400_BAD_REQUEST)
        elif device.enterprise_id:
            enterprise = device.enterprise
        else:
            return Response(
                {'error': 'No enterprise assigned to this device and no enterprise_id provided'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from utils.crypto import decrypt as _decrypt
        bearer_token = _decrypt(bytes(enterprise.bearer_token_enc))

        same_enterprise = (not enterprise_id or enterprise.pk == device.enterprise_id)
        use_single = same_enterprise and bool(device.cluster_device_name)

        try:
            if use_single:
                eve_version, device_connectivity, dev_status = fetch_device_status(
                    cluster=enterprise.cluster,
                    cluster_device_name=device.cluster_device_name,
                    bearer_token=bearer_token,
                    device=device,
                )
            else:
                from services.zedcloud import fetch_enterprise_devices, STATUS_MAP
                raw_devices = fetch_enterprise_devices(enterprise.cluster.host, bearer_token)
                matched = next(
                    (d for d in raw_devices if d.get('minfo', {}).get('serialNumber') == device.serial_number),
                    None,
                )
                if not matched:
                    return Response(
                        {'error': f'Serial {device.serial_number!r} not found in enterprise {enterprise.name!r}'},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                run_state = matched.get('runState', 'RUN_STATE_UNKNOWN')
                dev_status = STATUS_MAP.get(run_state, 'Unknown')
                eve_version = next(
                    (sw['shortVersion'] for sw in matched.get('swInfo', []) if sw.get('activated')), None,
                )
                connectivity = []
                for iface in matched.get('netStatusList', []):
                    if iface.get('up') and iface.get('uplink'):
                        mac = iface.get('macAddr', '')
                        iface_name = iface.get('ifName', '')
                        for ip in iface.get('ipAddrs', []):
                            if ip and ':' not in ip:
                                connectivity.append({'ip': ip, 'mac': mac, 'interface_name': iface_name})
                device_connectivity = connectivity or None
                device.cluster_device_name = matched.get('name', '')

            device.enterprise = enterprise
            device.cluster = enterprise.cluster
            device.eve_version = eve_version
            device.device_connectivity = device_connectivity
            device.status = dev_status
            device.status_fetched_at = timezone.now()
            device.save(update_fields=[
                'enterprise', 'cluster', 'cluster_device_name',
                'eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'updated_at',
            ])
            return Response(DeviceSerializer(device).data)

        except SerialMismatchError as e:
            return Response(
                {'error': 'Serial number mismatch', 'expected': e.expected, 'actual': e.actual},
                status=status.HTTP_409_CONFLICT,
            )
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if code == 404:
                device.eve_version = 'Unknown'
                device.device_connectivity = None
                device.status = 'Unknown'
                device.status_fetched_at = timezone.now()
                device.save(update_fields=['eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'updated_at'])
                return Response(DeviceSerializer(device).data)
            if code in (401, 403):
                return Response({'error': 'Bearer token invalid or expired'}, status=status.HTTP_403_FORBIDDEN)
            logger.exception('ZedCloud HTTP error %s for device %s', code, device.name)
            return Response({'error': f'ZedCloud returned HTTP {code}'}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as e:
            logger.exception('Failed to fetch status for device %s', device.name)
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
```

- [ ] **Step 2: Expose enterprise in DeviceSerializer**

The Refresh modal reads `device.enterprise?.id` to pre-select the dropdown. In `backend/apps/devices/serializers.py`:

Add `'enterprise'` to `DeviceSerializer.fields` list (after `'cluster'`):
```python
'model', 'cluster', 'enterprise',
```

Add `'enterprise'` to `read_only_fields`.

In `to_representation`, add after the cluster block:
```python
        ret['enterprise'] = {
            'id': instance.enterprise_id,
            'name': instance.enterprise.name,
        } if instance.enterprise_id else None
```

In `backend/apps/devices/views.py`, add `'enterprise'` to both `select_related` calls:
- `DeviceListCreateView.get` line ~67: `select_related('model', 'cluster', 'lab', 'team', 'enterprise')`
- `DeviceDetailView._get_device` line ~138: `select_related('model', 'cluster', 'lab', 'team', 'enterprise')`

- [ ] **Step 3: Update ChoicesView to include enterprises**

Replace the `ChoicesView.get` return statement (starting at line 495):
```python
    def get(self, request):
        from apps.enterprises.models import Enterprise
        enterprises = list(
            Enterprise.objects.select_related('cluster').values('id', 'name', 'cluster__name')
        )
        return Response({
            'labs': list(Lab.objects.values_list('name', flat=True)),
            'teams': list(Team.objects.values_list('name', flat=True)),
            'conditions': [c[0] for c in CONDITION_CHOICES],
            'enterprises': [
                {'id': e['id'], 'name': e['name'], 'cluster_name': e['cluster__name']}
                for e in enterprises
            ],
        })
```

- [ ] **Step 4: Remove Vault from settings and URLs**

In `backend/config/settings.py`, remove `'apps.vault'` from `INSTALLED_APPS`.

In `backend/config/urls.py`, remove:
```python
    path('api/v1/vault/', include('apps.vault.urls')),
```

- [ ] **Step 5: Run system check**

```bash
cd backend && python manage.py check
```

Expected: no errors. (The vault tables remain in the DB but the app is no longer loaded — that's acceptable; run `python manage.py dbshell` and `DROP TABLE vault_vault;` if you want to clean up manually.)

- [ ] **Step 6: Commit** — pause and ask user for approval.

```bash
git add backend/apps/devices/views.py backend/config/settings.py backend/config/urls.py
git commit -m "feat: revised device status API (enterprise_id), extend choices, remove Vault"
```

---

## Task 10: Frontend API clients

**Files:**
- Create: `frontend/src/api/enterprises.ts`
- Create: `frontend/src/api/untracked.ts`
- Create: `frontend/src/api/notifications.ts`
- Modify: `frontend/src/api/choices.ts`
- Modify: `frontend/src/api/devices.ts` (add `enterprise` field to Device type, update fetchDeviceStatus signature)

- [ ] **Step 1: Create enterprises.ts**

`frontend/src/api/enterprises.ts`:
```typescript
import client from './client'

export interface Enterprise {
  id: number
  name: string
  cluster: number
  cluster_name: string
  is_active: boolean
  last_sync_at: string | null
  last_sync_status: 'ok' | 'error' | 'token_expired' | null
  last_sync_error: string | null
}

export interface ClusterWithEnterprises {
  id: number
  name: string
  host: string
  enterprises: Enterprise[]
}

export async function getClusters(): Promise<ClusterWithEnterprises[]> {
  const res = await client.get('/clusters/')
  return res.data
}

export async function createCluster(data: { name: string; host?: string }): Promise<ClusterWithEnterprises> {
  const res = await client.post('/clusters/', data)
  return res.data
}

export async function updateCluster(id: number, data: { name?: string; host?: string }): Promise<ClusterWithEnterprises> {
  const res = await client.patch(`/clusters/${id}/`, data)
  return res.data
}

export async function deleteCluster(id: number): Promise<void> {
  await client.delete(`/clusters/${id}/`)
}

export async function createEnterprise(
  clusterId: number,
  data: { name: string; bearer_token: string; is_active?: boolean },
): Promise<Enterprise> {
  const res = await client.post(`/clusters/${clusterId}/enterprises/`, data)
  return res.data
}

export async function updateEnterprise(
  id: number,
  data: { name?: string; bearer_token?: string; is_active?: boolean },
): Promise<Enterprise> {
  const res = await client.patch(`/enterprises/${id}/`, data)
  return res.data
}

export async function deleteEnterprise(id: number): Promise<void> {
  await client.delete(`/enterprises/${id}/`)
}

export async function syncEnterprise(id: number): Promise<Enterprise> {
  const res = await client.post(`/enterprises/${id}/sync/`)
  return res.data
}

export async function exportClusters(): Promise<Blob> {
  const res = await client.get('/clusters/export/', { responseType: 'blob' })
  return res.data
}

export async function importClusters(config: unknown[], onConflict: 'overwrite' | 'skip'): Promise<unknown> {
  const res = await client.post('/clusters/import/', { config: JSON.stringify(config), on_conflict: onConflict })
  return res.data
}
```

- [ ] **Step 2: Create untracked.ts**

`frontend/src/api/untracked.ts`:
```typescript
import client from './client'

export interface UntrackedDevice {
  id: number
  enterprise: number
  enterprise_name: string
  cluster_name: string
  cluster_host: string
  zcloud_id: string
  name: string
  serial_number: string
  model: string
  run_state: string
  eve_version: string | null
  device_connectivity: Array<{ ip: string; mac: string; interface_name: string }> | null
  first_seen_at: string
  last_seen_at: string
}

export interface UntrackedFilters {
  enterprise?: string
  cluster?: string
  serial_number?: string
}

export async function getUntrackedDevices(filters: UntrackedFilters = {}): Promise<UntrackedDevice[]> {
  const res = await client.get('/untracked-devices/', { params: filters })
  return res.data
}

export async function moveToInventory(
  id: number,
  data: { lab: string; model: number },
): Promise<unknown> {
  const res = await client.post(`/untracked-devices/${id}/move-to-inventory/`, data)
  return res.data
}
```

- [ ] **Step 3: Create notifications.ts**

`frontend/src/api/notifications.ts`:
```typescript
import client from './client'

export interface PortalNotification {
  id: number
  kind: 'token_expired' | 'sync_error'
  title: string
  body: string
  created_at: string
  is_read: boolean
  read_at: string | null
}

export async function getNotifications(): Promise<PortalNotification[]> {
  const res = await client.get('/notifications/')
  return res.data
}

export async function markNotificationRead(id: number): Promise<PortalNotification> {
  const res = await client.post(`/notifications/${id}/read/`)
  return res.data
}

export async function markAllNotificationsRead(): Promise<void> {
  await client.post('/notifications/read-all/')
}
```

- [ ] **Step 4: Update choices.ts to include enterprises**

Replace `frontend/src/api/choices.ts`:
```typescript
import client from './client'

export interface EnterpriseChoice {
  id: number
  name: string
  cluster_name: string
}

export interface Choices {
  labs: string[]
  teams: string[]
  conditions: string[]
  enterprises: EnterpriseChoice[]
}

export async function getChoices(): Promise<Choices> {
  const res = await client.get('/choices/')
  return res.data
}
```

- [ ] **Step 5: Update Device type and fetchDeviceStatus signature in devices.ts**

Add `enterprise` field to the `Device` interface:
```typescript
  enterprise: { id: number; name: string } | null
```

Update `fetchDeviceStatus` function. First find and remove the old signature that takes `bearer_token`, `cluster_id`, `cluster_device_name`. Replace with:
```typescript
export async function fetchDeviceStatus(
  deviceId: number,
  data: { enterprise_id?: number },
): Promise<Device> {
  const res = await client.post(`/devices/${deviceId}/status/`, data)
  return res.data
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to new files).

- [ ] **Step 7: Commit** — pause and ask user for approval.

```bash
git add frontend/src/api/
git commit -m "feat: frontend API clients for enterprises, untracked devices, notifications"
```

---

## Task 11: Clusters & Enterprises page (read-only for members, full edit for admins)

**Files:**
- Create: `frontend/src/pages/ClusterEnterprisesPage.tsx`
- Create: `frontend/src/components/ImportClusterDialog.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Header.tsx`

- [ ] **Step 1: Create ImportClusterDialog**

`frontend/src/components/ImportClusterDialog.tsx`:
```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importClusters } from '@/api/enterprises'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const SAMPLE_JSON = `[
  {
    "cluster_name": "hummingbird",
    "cluster_host": "zcloud.hummingbird.zededa.net",
    "enterprises": [
      { "name": "Foundation",    "bearer_token": "eyJhbGci..." },
      { "name": "200x85",        "bearer_token": "eyJhbGci..." }
    ]
  }
]`

interface ImportClusterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportClusterDialog({ open, onOpenChange }: ImportClusterDialogProps) {
  const [onConflict, setOnConflict] = useState<'overwrite' | 'skip'>('skip')
  const [fileError, setFileError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<unknown[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => importClusters(parsed!, onConflict),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ['clusters-enterprises'] })
      const msg = `Imported: ${result.created_clusters} clusters, ${result.created_enterprises} enterprises added, ${result.updated_enterprises} updated, ${result.skipped_enterprises} skipped.`
      if (result.errors?.length) {
        toast.warning(msg + ` Errors: ${result.errors.join('; ')}`)
      } else {
        toast.success(msg)
      }
      onOpenChange(false)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Import failed')
    },
  })

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setFileError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (!Array.isArray(data)) throw new Error('JSON must be an array')
        setParsed(data)
      } catch (err: any) {
        setFileError(err.message)
        setParsed(null)
      }
    }
    reader.readAsText(file)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Cluster Config</DialogTitle>
          <DialogDescription>Select a JSON file to import clusters and enterprises.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Expected format</p>
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto font-mono leading-relaxed">{SAMPLE_JSON}</pre>
          </div>
          <div>
            <label className="text-sm font-medium">JSON File</label>
            <input type="file" accept=".json" onChange={handleFile} className="block mt-1 text-sm" />
            {fileName && !fileError && <p className="text-xs text-muted-foreground mt-1">{fileName} — ready</p>}
            {fileError && <p className="text-xs text-destructive mt-1">{fileError}</p>}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">If enterprise already exists</label>
            <div className="flex gap-4">
              {(['skip', 'overwrite'] as const).map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="on_conflict"
                    value={opt}
                    checked={onConflict === opt}
                    onChange={() => setOnConflict(opt)}
                  />
                  {opt === 'skip' ? 'Skip (keep existing token)' : 'Overwrite token'}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!parsed || mutation.isPending}>
            {mutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create ClusterEnterprisesPage**

`frontend/src/pages/ClusterEnterprisesPage.tsx`:
```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getClusters, createCluster, updateCluster, deleteCluster,
  createEnterprise, updateEnterprise, deleteEnterprise, syncEnterprise, exportClusters,
  type ClusterWithEnterprises, type Enterprise,
} from '@/api/enterprises'
import { Header } from '@/components/Header'
import { useUser } from '@/context/UserContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ImportClusterDialog } from '@/components/ImportClusterDialog'
import { toast } from '@/components/ui/sonner'
import { Plus, Download, Upload, RefreshCw, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

function syncBadge(status: Enterprise['last_sync_status']) {
  if (!status) return null
  const map = {
    ok: 'bg-green-100 text-green-800',
    error: 'bg-yellow-100 text-yellow-800',
    token_expired: 'bg-red-100 text-red-800',
  } as const
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[status]}`}>
      {status === 'token_expired' ? 'Token Expired' : status === 'error' ? 'Error' : 'OK'}
    </span>
  )
}

function timeStr(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString()
}

export default function ClusterEnterprisesPage() {
  const qc = useQueryClient()
  const { isAdmin } = useUser()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [addingCluster, setAddingCluster] = useState(false)
  const [newClusterName, setNewClusterName] = useState('')
  const [newClusterHost, setNewClusterHost] = useState('')
  const [addingEnterpriseFor, setAddingEnterpriseFor] = useState<number | null>(null)
  const [newEntName, setNewEntName] = useState('')
  const [newEntToken, setNewEntToken] = useState('')
  const [editingEnterprise, setEditingEnterprise] = useState<Enterprise | null>(null)
  const [editEntName, setEditEntName] = useState('')
  const [editEntToken, setEditEntToken] = useState('')

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ['clusters-enterprises'],
    queryFn: getClusters,
  })

  const createClusterMut = useMutation({
    mutationFn: () => createCluster({ name: newClusterName, host: newClusterHost || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); setAddingCluster(false); setNewClusterName(''); setNewClusterHost('') },
    onError: (e: any) => toast.error(e?.response?.data?.host ?? e?.response?.data?.name ?? 'Failed'),
  })

  const deleteClusterMut = useMutation({
    mutationFn: (id: number) => deleteCluster(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Cannot delete cluster'),
  })

  const createEntMut = useMutation({
    mutationFn: (clusterId: number) => createEnterprise(clusterId, { name: newEntName, bearer_token: newEntToken }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); setAddingEnterpriseFor(null); setNewEntName(''); setNewEntToken('') },
    onError: (e: any) => toast.error(e?.response?.data?.name ?? e?.response?.data?.bearer_token ?? 'Failed'),
  })

  const updateEntMut = useMutation({
    mutationFn: () => updateEnterprise(editingEnterprise!.id, { name: editEntName || undefined, bearer_token: editEntToken || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); setEditingEnterprise(null) },
    onError: (e: any) => toast.error(e?.response?.data?.name ?? 'Failed'),
  })

  const deleteEntMut = useMutation({
    mutationFn: (id: number) => deleteEnterprise(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }),
    onError: () => toast.error('Failed to delete enterprise'),
  })

  const syncEntMut = useMutation({
    mutationFn: (id: number) => syncEnterprise(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); toast.success('Sync triggered') },
    onError: () => toast.error('Sync failed'),
  })

  async function handleExport() {
    const blob = await exportClusters()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cluster-config.json'; a.click()
    URL.revokeObjectURL(url)
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-14 px-4 py-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Clusters &amp; Enterprises</h1>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload className="w-4 h-4 mr-1" />Import</Button>
              <Button size="sm" onClick={() => setAddingCluster(true)}><Plus className="w-4 h-4 mr-1" />Add Cluster</Button>
            </div>
          )}
        </div>

        {isAdmin && addingCluster && (
          <div className="border rounded p-4 mb-4 space-y-3 bg-muted/30">
            <h3 className="text-sm font-medium">New Cluster</h3>
            <Input placeholder="Name" value={newClusterName} onChange={(e) => setNewClusterName(e.target.value)} />
            <Input placeholder="Host (e.g. zcloud.hummingbird.zededa.net)" value={newClusterHost} onChange={(e) => setNewClusterHost(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createClusterMut.mutate()} disabled={!newClusterName || createClusterMut.isPending}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingCluster(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

        <div className="space-y-3">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="border rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 select-none"
                onClick={() => toggleExpand(cluster.id)}
              >
                <div className="flex items-center gap-2">
                  {expanded.has(cluster.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-medium text-sm">{cluster.name}</span>
                  <span className="text-xs text-muted-foreground">{cluster.host}</span>
                  <Badge variant="outline" className="text-xs">{cluster.enterprises.length} enterprise{cluster.enterprises.length !== 1 ? 's' : ''}</Badge>
                </div>
                {isAdmin && (
                  <Button
                    size="sm" variant="ghost"
                    className="text-destructive hover:text-destructive h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete cluster ${cluster.name}?`)) deleteClusterMut.mutate(cluster.id) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {expanded.has(cluster.id) && (
                <div className="border-t">
                  {cluster.enterprises.map((ent) => (
                    <div key={ent.id} className="px-4 py-3 border-b last:border-b-0 flex items-center justify-between gap-4 hover:bg-muted/10">
                      {isAdmin && editingEnterprise?.id === ent.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input className="h-7 text-xs w-36" value={editEntName} onChange={(e) => setEditEntName(e.target.value)} placeholder="Name" />
                          <Input className="h-7 text-xs w-64" type="password" value={editEntToken} onChange={(e) => setEditEntToken(e.target.value)} placeholder="New token (leave blank to keep)" />
                          <Button size="sm" className="h-7 text-xs" onClick={() => updateEntMut.mutate()} disabled={updateEntMut.isPending}>Save</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingEnterprise(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-sm font-medium">{ent.name}</span>
                            {syncBadge(ent.last_sync_status)}
                            {ent.last_sync_error && (
                              <Tooltip>
                                <TooltipTrigger asChild><span className="text-xs text-muted-foreground cursor-help underline decoration-dotted">error</span></TooltipTrigger>
                                <TooltipContent><p className="max-w-xs text-xs">{ent.last_sync_error}</p></TooltipContent>
                              </Tooltip>
                            )}
                            <span className="text-xs text-muted-foreground hidden sm:block">Last sync: {timeStr(ent.last_sync_at)}</span>
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => syncEntMut.mutate(ent.id)} disabled={syncEntMut.isPending}><RefreshCw className="w-3.5 h-3.5" /></Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingEnterprise(ent); setEditEntName(ent.name); setEditEntToken('') }}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => { if (confirm(`Delete ${ent.name}?`)) deleteEntMut.mutate(ent.id) }}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}

                  {isAdmin && (
                    addingEnterpriseFor === cluster.id ? (
                      <div className="px-4 py-3 flex items-center gap-2 bg-muted/20">
                        <Input className="h-7 text-xs w-36" value={newEntName} onChange={(e) => setNewEntName(e.target.value)} placeholder="Enterprise name" />
                        <Input className="h-7 text-xs w-64" type="password" value={newEntToken} onChange={(e) => setNewEntToken(e.target.value)} placeholder="Bearer token" />
                        <Button size="sm" className="h-7 text-xs" onClick={() => createEntMut.mutate(cluster.id)} disabled={!newEntName || !newEntToken || createEntMut.isPending}>Add</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddingEnterpriseFor(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="px-4 py-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setAddingEnterpriseFor(cluster.id); setNewEntName(''); setNewEntToken('') }}>
                          <Plus className="w-3.5 h-3.5 mr-1" /> Add Enterprise
                        </Button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <ImportClusterDialog open={showImport} onOpenChange={setShowImport} />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Add route + nav tab in App.tsx and Header.tsx**

In `frontend/src/App.tsx`, add lazy import:
```typescript
const ClusterEnterprisesPage = lazy(() => import('@/pages/ClusterEnterprisesPage'))
```

Add route inside `AuthenticatedRoutes`:
```tsx
<Route path="/cluster-enterprises" element={<ClusterEnterprisesPage />} />
```

In `frontend/src/components/Header.tsx`, update the nav items array — Clusters & Enterprises is visible to **all** users (read-only for members):
```tsx
const navItems = [
  { to: '/devices', label: 'Devices' },
  { to: '/users', label: 'Users' },
  { to: '/untracked-devices', label: 'Untracked' },
  { to: '/cluster-enterprises', label: 'Clusters & Enterprises' },
]
```

Replace the inline array in the `map` call with `navItems`.

- [ ] **Step 4: Start dev server and test**

```bash
cd frontend && npm run dev
```

Navigate to `/cluster-enterprises` as an admin. Verify clusters load, expand works, add/delete cluster and enterprise forms appear.

- [ ] **Step 5: Commit** — pause and ask user for approval.

```bash
git add frontend/src/pages/ClusterEnterprisesPage.tsx frontend/src/components/ImportClusterDialog.tsx frontend/src/App.tsx frontend/src/components/Header.tsx
git commit -m "feat: Clusters & Enterprises admin page with import/export"
```

---

## Task 12: Untracked Devices page

**Files:**
- Create: `frontend/src/pages/UntrackedDevicesPage.tsx`
- Create: `frontend/src/components/MoveToInventoryDialog.tsx`
- Modify: `frontend/src/App.tsx` (route already added in Task 11 — verify)

- [ ] **Step 1: Create MoveToInventoryDialog**

`frontend/src/components/MoveToInventoryDialog.tsx`:
```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moveToInventory, type UntrackedDevice } from '@/api/untracked'
import { getChoices } from '@/api/choices'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'

interface Props {
  device: UntrackedDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoveToInventoryDialog({ device, open, onOpenChange }: Props) {
  const [lab, setLab] = useState('')
  const [modelId, setModelId] = useState('')
  const qc = useQueryClient()

  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })

  // For model picker we use the device_models endpoint via choices; fallback to free-text for now.
  // A future task can wire in the device model list — for now the field accepts a numeric ID.
  const labOptions = (choices?.labs ?? []).map((l) => ({ value: l, label: l }))

  const mutation = useMutation({
    mutationFn: () => moveToInventory(device!.id, { lab, model: parseInt(modelId) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['untracked-devices'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`${device?.name} moved to inventory`)
      onOpenChange(false)
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to move device')
    },
  })

  if (!device) return null

  const connectivity = device.device_connectivity
  const ifacesSummary = connectivity?.length
    ? connectivity.map((c) => `${c.interface_name} ${c.ip}`).join(', ')
    : '—'

  const rows: [string, string][] = [
    ['Name', device.name],
    ['Serial Number', device.serial_number],
    ['Model (text)', device.model || '—'],
    ['Enterprise', device.enterprise_name],
    ['Cluster', device.cluster_name],
    ['Run State', device.run_state],
    ['EVE Version', device.eve_version ?? '—'],
    ['Interfaces', ifacesSummary],
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Move to Inventory</DialogTitle>
          <DialogDescription>Review the device details before confirming.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm border-collapse">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-b last:border-0">
                <td className="py-1.5 pr-4 text-muted-foreground font-medium w-36">{label}</td>
                <td className="py-1.5 font-mono text-xs break-all">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-sm font-medium block mb-1">Lab *</label>
            <SearchableSelect
              options={labOptions}
              value={lab}
              onValueChange={setLab}
              placeholder="Select lab..."
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Device Model ID *</label>
            <input
              type="number"
              className="border rounded px-3 py-1.5 text-sm w-full"
              placeholder="Enter device model ID from /admin"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!lab || !modelId || mutation.isPending}
          >
            {mutation.isPending ? 'Moving...' : 'Confirm Move to Inventory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create UntrackedDevicesPage**

`frontend/src/pages/UntrackedDevicesPage.tsx`:
```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUntrackedDevices, type UntrackedDevice } from '@/api/untracked'
import { Header } from '@/components/Header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MoveToInventoryDialog } from '@/components/MoveToInventoryDialog'
import { PackagePlus } from 'lucide-react'

function timeStr(dt: string) {
  return new Date(dt).toLocaleString()
}

export default function UntrackedDevicesPage() {
  const [enterpriseFilter, setEnterpriseFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [serialFilter, setSerialFilter] = useState('')
  const [selected, setSelected] = useState<UntrackedDevice | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['untracked-devices', enterpriseFilter, clusterFilter, serialFilter],
    queryFn: () => getUntrackedDevices({
      enterprise: enterpriseFilter || undefined,
      cluster: clusterFilter || undefined,
      serial_number: serialFilter || undefined,
    }),
  })

  function openMove(d: UntrackedDevice) {
    setSelected(d)
    setDialogOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-14 px-4 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Untracked Devices</h1>
          <span className="text-sm text-muted-foreground">{devices.length} device{devices.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex gap-3 mb-4">
          <Input placeholder="Enterprise..." value={enterpriseFilter} onChange={(e) => setEnterpriseFilter(e.target.value)} className="w-40" />
          <Input placeholder="Cluster..." value={clusterFilter} onChange={(e) => setClusterFilter(e.target.value)} className="w-40" />
          <Input placeholder="Serial number..." value={serialFilter} onChange={(e) => setSerialFilter(e.target.value)} className="w-48" />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Serial No</th>
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className="pb-2 pr-4 font-medium">Enterprise</th>
                <th className="pb-2 pr-4 font-medium">Cluster</th>
                <th className="pb-2 pr-4 font-medium">Run State</th>
                <th className="pb-2 pr-4 font-medium">EVE Version</th>
                <th className="pb-2 pr-4 font-medium">First Seen</th>
                <th className="pb-2 pr-4 font-medium">Last Seen</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b hover:bg-muted/30">
                  <td className="py-2 pr-4 font-medium">{d.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{d.serial_number}</td>
                  <td className="py-2 pr-4 text-xs">{d.model || '—'}</td>
                  <td className="py-2 pr-4">{d.enterprise_name}</td>
                  <td className="py-2 pr-4">{d.cluster_name}</td>
                  <td className="py-2 pr-4 text-xs">{d.run_state}</td>
                  <td className="py-2 pr-4 text-xs">{d.eve_version ?? '—'}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{timeStr(d.first_seen_at)}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{timeStr(d.last_seen_at)}</td>
                  <td className="py-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openMove(d)}>
                      <PackagePlus className="w-3.5 h-3.5 mr-1" /> Move
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && devices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No untracked devices found.</p>
          )}
        </div>

        <MoveToInventoryDialog
          device={selected}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Add route in App.tsx**

Add lazy import and route (the nav link was already added in Task 11):
```typescript
const UntrackedDevicesPage = lazy(() => import('@/pages/UntrackedDevicesPage'))
```

```tsx
<Route path="/untracked-devices" element={<UntrackedDevicesPage />} />
```

- [ ] **Step 4: Test in browser**

```bash
cd frontend && npm run dev
```

Navigate to `/untracked-devices`. Verify empty state, filter inputs, table columns render correctly.

- [ ] **Step 5: Commit** — pause and ask user for approval.

```bash
git add frontend/src/pages/UntrackedDevicesPage.tsx frontend/src/components/MoveToInventoryDialog.tsx frontend/src/App.tsx
git commit -m "feat: Untracked Devices page with move-to-inventory dialog"
```

---

## Task 13: Revised Refresh Status modal + admin notification bell

**Files:**
- Modify: `frontend/src/components/FetchStatusDialog.tsx`
- Modify: `frontend/src/components/NotificationPanel.tsx`

- [ ] **Step 1: Rewrite FetchStatusDialog**

Replace entire contents of `frontend/src/components/FetchStatusDialog.tsx`:
```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDeviceStatus, type Device } from '@/api/devices'
import { getChoices } from '@/api/choices'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'
import { AlertTriangle } from 'lucide-react'

const schema = z.object({
  enterprise_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface FetchStatusDialogProps {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FetchStatusDialog({ device, open, onOpenChange }: FetchStatusDialogProps) {
  const [apiError, setApiError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })

  const enterpriseOptions = (choices?.enterprises ?? []).map((e) => ({
    value: e.id.toString(),
    label: `${e.name} — ${e.cluster_name}`,
  }))

  const currentEnterpriseId = (device as any).enterprise?.id?.toString() ?? ''

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { enterprise_id: currentEnterpriseId },
  })

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      fetchDeviceStatus(device.id, {
        enterprise_id: values.enterprise_id ? parseInt(values.enterprise_id) : undefined,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      if (data.status === 'Unknown' && data.eve_version === 'Unknown') {
        toast(`${device.name} not found in enterprise`)
      } else {
        toast.success('Status refreshed')
      }
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      const s = (err as any)?.response?.status
      const d = (err as any)?.response?.data
      if (s === 409) {
        setApiError(`Serial mismatch — Expected: ${d?.expected ?? '?'} · Got: ${d?.actual ?? '?'}`)
      } else if (s === 403) {
        setApiError('Bearer token invalid or expired')
      } else if (s === 404) {
        toast(`${device.name} not found in selected enterprise`)
        onOpenChange(false)
      } else {
        setApiError(d?.error ?? d?.detail ?? `Error ${s}`)
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Refresh Status — {device.name}</DialogTitle>
          <DialogDescription>Fetch current status from ZedCloud via an enterprise credential.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => { setApiError(null); mutation.mutate(v) })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="enterprise_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Enterprise</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      options={enterpriseOptions}
                      value={field.value ?? ''}
                      onValueChange={field.onChange}
                      placeholder="Select enterprise..."
                      hintBelow
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {apiError && (
              <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {apiError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Fetching...' : 'Fetch Status'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add admin token-expiry notifications to NotificationPanel**

In `frontend/src/components/NotificationPanel.tsx`, add imports at the top:
```typescript
import { useNavigate } from 'react-router-dom'
import { getNotifications, markNotificationRead, markAllNotificationsRead, type PortalNotification } from '@/api/notifications'
```

Inside `NotificationBell`, add after the existing queries:
```typescript
  const { isAdmin } = useUser()
  const navigate = useNavigate()

  const { data: adminNotifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    enabled: isAdmin,
    refetchInterval: config?.notification_refresh_ms ?? 30_000,
  })

  const markReadMut = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllReadMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  function handleNotificationClick(n: PortalNotification) {
    markReadMut.mutate(n.id)
    if (n.kind === 'token_expired' || n.kind === 'sync_error') {
      navigate('/cluster-enterprises')
    }
    setOpen(false)
  }

  const unreadAdminCount = adminNotifications.filter((n) => !n.is_read).length
```

Update the `count` variable:
```typescript
  const count = actionable.length + unreadAdminCount
```

Add admin notifications section inside the `PopoverContent`, before the empty state check:
```tsx
        {isAdmin && adminNotifications.length > 0 && (
          <div>
            <div className="px-3 pt-3 pb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">System Alerts</p>
              {unreadAdminCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => markAllReadMut.mutate()}
                >
                  Mark all read
                </button>
              )}
            </div>
            {adminNotifications.slice(0, 10).map((n) => (
              <div
                key={n.id}
                className={cn(
                  'px-3 py-2 hover:bg-muted/50 border-b border-border/50 cursor-pointer',
                  !n.is_read && 'bg-muted/20',
                )}
                onClick={() => handleNotificationClick(n)}
              >
                <p className={cn('text-sm font-medium', !n.is_read && 'text-foreground')}>{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}
```

Update the empty state condition:
```tsx
        {actionable.length === 0 && mine.length === 0 && (!isAdmin || adminNotifications.length === 0) && (
          <div className="py-8 text-center text-sm text-foreground">
            No notifications
          </div>
        )}
```

- [ ] **Step 3: Test in browser**

```bash
cd frontend && npm run dev
```

1. Open Refresh Status modal on a device — verify enterprise dropdown appears, cluster/bearer token fields are gone.
2. Open notification bell as admin — verify admin alerts section appears (empty if no notifications).
3. Navigate to `/cluster-enterprises`, add a test enterprise with an invalid token, trigger sync — verify token_expired notification appears in bell, clicking navigates to `/cluster-enterprises`.

- [ ] **Step 4: Commit** — pause and ask user for approval.

```bash
git add frontend/src/components/FetchStatusDialog.tsx frontend/src/components/NotificationPanel.tsx
git commit -m "feat: revised Refresh Status modal and admin notification bell for token expiry"
```

---

## Post-implementation checklist

- [ ] Run full backend check: `cd backend && python manage.py check --deploy`
- [ ] Verify `DeviceSerializer` does NOT include `enterprise.bearer_token_enc` in output
- [ ] Confirm `UNAVAILABLE_CONDITIONS` in `devices/views.py` and `reservations/views.py` both still have `'missing'`
- [ ] Confirm `GET /api/v1/choices/` returns `enterprises` array
- [ ] Confirm `GET /api/v1/clusters/export/` returns JSON without any `bearer_token` field
- [ ] Confirm `POST /api/v1/clusters/import/` with `on_conflict=skip` and `on_conflict=overwrite` both work
- [ ] Start server with `RUN_MAIN=true python manage.py runserver` and verify APScheduler log line appears
- [ ] TypeScript: `cd frontend && npx tsc --noEmit`
- [ ] Frontend: verify `/devices`, `/users`, `/untracked-devices`, `/cluster-enterprises` all load without console errors
- [ ] Verify Vault URLs no longer accessible: `curl http://localhost:8000/api/v1/vault/` → 404
