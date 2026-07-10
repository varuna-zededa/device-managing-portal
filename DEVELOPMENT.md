# Development Reference

AI-targeted implementation guide. For product decisions and data models: [DESIGN.md](DESIGN.md).
For critical conventions and gotchas: [CLAUDE.md](CLAUDE.md).

---

## API versioning

All endpoints are prefixed `/api/v1/`. The frontend axios client (`src/api/client.ts`) sets `baseURL: '/api/v1'` so all API module calls automatically use the correct prefix.

---

## Running locally

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set SECRET_KEY and ENCRYPTION_KEY
python manage.py migrate
python manage.py loaddata clusters_seed.json
python manage.py runserver    # http://localhost:8000

# Frontend (separate terminal)
cd frontend && npm install
npm run dev                   # http://localhost:5173 — proxies /api/* to :8000
```

Generate keys:
```bash
# SECRET_KEY
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
# ENCRYPTION_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Django admin (create superuser first): `python manage.py createsuperuser` → `/admin/`

---

## Backend

### Project layout
```
backend/
├── config/settings.py           all settings; reads .env via django-environ
├── config/urls.py               /api/* routing; /admin/
├── apps/clusters/               Cluster model + CRUD
├── apps/device_models/          DeviceModel (name + customer_partner_name)
├── apps/devices/
│   ├── models.py                Device, Lab, CONDITION_CHOICES
│   ├── views.py                 DeviceViewSet; UNAVAILABLE_CONDITIONS; _handle_condition_change; ChoicesView
│   ├── serializers.py
│   ├── admin.py                 Device, Lab registered
│   └── migrations/
├── apps/users/
│   ├── models.py                PortalUser, Team
│   ├── views.py
│   ├── admin.py                 PortalUser, Team registered
│   └── migrations/
├── apps/vault/                  Vault (encrypted tokens per user per cluster)
├── apps/reservations/
│   ├── views.py                 reservation flow; _UNAVAILABLE_CONDITIONS (keep in sync with devices/views.py)
│   └── models.py                ReservationRequest
├── apps/admin_tools/views.py    ExportView, ImportView, ImportTemplateView, LatencyView, _normalize_condition()
├── services/zedcloud.py         fetch_device_status(); SerialMismatchError
└── utils/
    ├── crypto.py                encrypt(str)->bytes; decrypt(bytes)->str
    ├── email.py                 all outbound email functions
    └── permissions.py           get_user_email(), is_admin(); IsPortalUser, IsAdminPortalUser, IsOwnerOrAdmin
```

### Auth pattern — every protected view

Every view declares `permission_classes` explicitly. `DEFAULT_PERMISSION_CLASSES = []` so any view without it is public.

```python
from utils.permissions import get_user_email, is_admin, IsPortalUser, IsAdminPortalUser

class MyView(APIView):
    permission_classes = [IsPortalUser]       # any registered user
    # or: permission_classes = [IsAdminPortalUser]  # admin only; replaces inline is_admin() check
    # or: permission_classes = []             # public (token-based endpoints only)

    def post(self, request):
        user_email = get_user_email(request)  # reads X-User-Email header

        # inline admin check (only when class uses IsPortalUser but one method needs admin)
        if not is_admin(user_email):
            return Response({'error': 'Admin only'}, status=403)

        # owner check
        if device.owner_email != user_email:
            return Response({'error': 'Not the owner'}, status=403)
```

**Permission classes in `utils/permissions.py`:**
| Class | Allows |
|---|---|
| `IsPortalUser` | Any email registered in the PortalUser table |
| `IsAdminPortalUser` | Users with `user_type == 'admin'` |
| `IsOwnerOrAdmin` | Object owner or admin (for `check_object_permissions`) |

### Encryption pattern
```python
from utils.crypto import encrypt, decrypt

# store
device.idrac_password_enc = encrypt(raw_password)

# retrieve (never expose in API response)
raw = decrypt(device.idrac_password_enc)
```

### Condition change side-effects (`apps/devices/views.py` → `_handle_condition_change`)
| New condition | Clears owner | Expires requests | Emails admins |
|---|---|---|---|
| `out_of_order` | yes | yes | yes |
| `temporarily_leased` | yes | yes | no |
| `missing` | yes | yes | no |
| `dedicated` | yes | yes | no (requires `device.team` set) |
| `needs_repair` | no | no | no |
| `normal` (clear) | no | no | no |

### Serializer field validation pattern

All write serializers validate inputs. Follow these patterns when adding new fields:

**FK fields (lab, team):** Use `SlugRelatedField` — accepts/returns the name string, enforces FK at DB level:
```python
lab = serializers.SlugRelatedField(queryset=Lab.objects.all(), slug_field='name')
```

**Nullable FK fields (device team):** Use `NullableSlugRelatedField` from `apps/devices/serializers.py` — converts `""` to `None`:
```python
team = NullableSlugRelatedField(
    queryset=Team.objects.all(), slug_field='name', allow_null=True, required=False,
)
```

**String validators in serializers:**
```python
def validate_name(self, value):
    if not (value or '').strip():
        raise serializers.ValidationError('Name must not be blank.')
    return value.strip()
```

**Always add `select_related` for FK fields** to avoid N+1 queries:
```python
Device.objects.select_related('model', 'cluster', 'lab', 'team')
```

**Filter queries after FK conversion** use double-underscore traversal:
```python
qs.filter(team__name=team)   # not qs.filter(team=team)
qs.filter(lab__name=lab)
```

### Email pattern
```python
from utils.email import send_reservation_request   # example

# always fail_silently=False; catch and log
try:
    send_reservation_request(device, requester, owner)
except Exception as e:
    logger.warning('Email failed: %s', e)
```

### ZedCloud fetch (`services/zedcloud.py`)

A module-level `_client = httpx.Client(timeout=30)` is shared across all calls (connection reuse, no per-call overhead).

```python
_client = httpx.Client(timeout=30)

def fetch_device_status(
    cluster, cluster_device_name: str, bearer_token: str, device,
) -> tuple[str | None, list | None, str]:
    url = f'https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info'
    response = _client.get(url, headers={'Authorization': f'Bearer {bearer_token}'})
    response.raise_for_status()
    data = response.json()

    # serial: minfo first, hardwareInfo fallback
    actual_serial = data.get('minfo', {}).get('serialNumber', '') \
                    or data.get('hardwareInfo', {}).get('serialNum', '')

    # EVE version: active partition
    eve_version = next((sw['shortVersion'] for sw in data.get('swInfo', []) if sw.get('activated')), None)

    # connectivity: up + uplink interfaces; field is ifName (NOT name)
    connectivity = []
    for iface in data.get('netStatusList', []):
        if iface.get('up') and iface.get('uplink'):
            for ip in iface.get('ipAddrs', []):
                if ':' not in ip:   # IPv4 only
                    connectivity.append({'ip': ip, 'mac': iface.get('macAddr', ''), 'interface_name': iface.get('ifName', '')})

    run_state = data.get('runState', 'RUN_STATE_UNKNOWN')
    return eve_version, connectivity or None, STATUS_MAP.get(run_state, 'Unknown')
```

### Choices endpoint (`apps/devices/views.py` → `ChoicesView`)
```python
return Response({
    'labs':       list(Lab.objects.values_list('name', flat=True)),
    'teams':      list(Team.objects.values_list('name', flat=True)),
    'conditions': [c[0] for c in CONDITION_CHOICES],
})
```
Do not hardcode lab or team lists here.

### Migrations
```bash
python manage.py makemigrations   # after any model change
python manage.py migrate
```
Always commit migration files with the model change that produced them.

---

## Frontend

### Project layout
```
frontend/src/
├── api/
│   ├── client.ts          axios instance; auto-injects X-User-Email from localStorage
│   ├── devices.ts         device CRUD + reserve/release/status/history
│   ├── users.ts           user CRUD
│   └── choices.ts         getChoices() → {labs, teams, conditions}
├── context/UserContext.tsx useUser() → {user, isAdmin}; redirects to /login if no session
├── components/
│   ├── DeviceTable.tsx    CONDITION_STYLES, CONDITION_BADGE_STYLES, sort logic, expand panel
│   ├── SearchBar.tsx      CONDITION_LABELS; filter order: availability→condition→lab→team
│   ├── Header.tsx
│   ├── NotificationPanel.tsx
│   ├── DeviceFormModal.tsx
│   ├── ReserveDialog.tsx
│   ├── OwnershipHistoryModal.tsx
│   └── ui/                shadcn/ui base components
└── pages/
    ├── DevicesPage.tsx    summary bar; passes filter state to SearchBar + DeviceTable
    ├── UsersPage.tsx      sortable table; admin only
    ├── LoginPage.tsx
    └── ConfirmReservationPage.tsx  /confirm/:token; no auth needed
```

### API call pattern
```typescript
// query
const { data: devices = [], isLoading } = useQuery({
  queryKey: ['devices'],
  queryFn: getDevices,
})

// mutation — always invalidate after success
const mutation = useMutation({
  mutationFn: (id: number) => releaseDevice(id),
  onSuccess: () => {
    toast.success('Released')
    queryClient.invalidateQueries({ queryKey: ['devices'] })
  },
  onError: () => toast.error('Failed'),
})
```

Cache keys in use: `['devices']`, `['users']`, `['choices']`, `['reservations','pending']`, `['reservations','mine']`.  
`choices` uses `staleTime: Infinity` — cache cleared on full page reload.

### Condition constants (both in `DeviceTable.tsx`)
```typescript
const CONDITION_STYLES: Record<string, string> = {
  out_of_order:       'border-l-4 border-l-red-500 bg-red-950/10',
  needs_repair:       'border-l-4 border-l-yellow-400 bg-yellow-950/10',
  temporarily_leased: 'border-l-4 border-l-violet-400 bg-violet-950/10',
  dedicated:          'border-l-4 border-l-blue-400 bg-blue-950/10',
  missing:            'border-l-4 border-l-orange-400 bg-orange-50/10',
}

const CONDITION_BADGE_STYLES: Record<string, string> = {
  out_of_order:       'bg-red-500/20 text-red-400 border-red-500/30',
  needs_repair:       'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  temporarily_leased: 'bg-violet-400/20 text-violet-400 border-violet-400/30',
  dedicated:          'bg-blue-400/20 text-blue-400 border-blue-400/30',
  missing:            'bg-orange-400/20 text-orange-400 border-orange-400/30',
}
```

`CONDITION_LABELS` (in `SearchBar.tsx`) maps the same keys to display strings.

### Sort pattern (DeviceTable.tsx)
```typescript
const [sortKey, setSortKey] = useState<SortKey>(null)  // SortKey = union of column names | null
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

function handleSort(key: SortKey) {
  if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
  else { setSortKey(key); setSortDir('asc') }
}

const sorted = sortKey ? [...devices].sort((a, b) => {
  let av = '', bv = ''
  switch (sortKey) { /* case per column */ }
  if (!av && bv) return 1    // empty always last
  if (av && !bv) return -1
  return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
}) : devices
```

### Admin-only page guard
```typescript
const { isAdmin } = useUser()
if (!isAdmin) return <Navigate to="/devices" replace />
```

---

## Feature checklists

### New device condition
- [ ] `apps/devices/models.py` — add `('snake_case', 'Display Name')` to `CONDITION_CHOICES`
- [ ] `apps/devices/models.py` — add to `is_available` exclusion if it blocks reservation
- [ ] `apps/devices/views.py` — add to `UNAVAILABLE_CONDITIONS` if it clears owner + blocks reserve
- [ ] `apps/reservations/views.py` — add to `_UNAVAILABLE_CONDITIONS` (keep in sync)
- [ ] `apps/devices/views.py` — add branch in `_handle_condition_change()` for side-effects
- [ ] `frontend/src/components/DeviceTable.tsx` — add to `CONDITION_STYLES`, `CONDITION_BADGE_STYLES`
- [ ] `frontend/src/components/DeviceTable.tsx` — add to `isUnavailable` if it blocks reserve UI
- [ ] `frontend/src/components/SearchBar.tsx` — add to `CONDITION_LABELS`
- [ ] Run `makemigrations` + `migrate`

### New Lab or Team
No code changes. Django admin → Labs (or Teams) → Add.

### New API endpoint
1. Add view/method in `apps/{app}/views.py`
2. Register URL in `apps/{app}/urls.py`
3. If new prefix: add to `config/urls.py`
4. Add corresponding function in `frontend/src/api/{module}.ts` using `client.ts`

### New device table column
1. `apps/devices/serializers.py` — add field to `DeviceSerializer`
2. `frontend/src/api/devices.ts` — add to `Device` interface
3. `frontend/src/components/DeviceTable.tsx`:
   - Add `<th>` with `onClick={() => handleSort('key')}` and `<SortIcon col="key" />`
   - Add to `SortKey` type
   - Add `case 'key':` in the sort switch
   - Add `<td>` in the row body
4. If shown in expand panel: add `<CopyableField>` in the relevant card

### New filter (device list)
1. `DevicesPage.tsx` — add `useState` for the filter value
2. `SearchBar.tsx` — add `<Select>` for the filter; pass value + setter as props
3. `frontend/src/api/devices.ts` — add param to `getDevices()` query string
4. `apps/devices/views.py` → `DeviceViewSet.get_queryset()` — add filter clause

### New email notification
1. Add function to `utils/email.py` following existing pattern
2. Call from view with `fail_silently=False` + catch + `logger.warning()`
3. No-op if `settings.EMAIL_HOST` is blank — no special handling needed

### New write endpoint (validation checklist)
- [ ] Declare `permission_classes` explicitly on every view — omitting them makes the endpoint public
- [ ] Use `SlugRelatedField` for FK fields (lab, team); `NullableSlugRelatedField` for nullable FK
- [ ] Add `validate_<field>` methods for string fields that must be non-blank or format-constrained
- [ ] Add the FK fields to `select_related` on all querysets that touch those models
- [ ] Update filter clauses from `field=value` to `field__name=value` after FK conversion
