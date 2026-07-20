# Graph Report - .  (2026-07-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1158 nodes · 2184 edges · 130 communities (88 shown, 42 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 294 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5a3deb71`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Device
- DeviceFormModal.tsx
- dependencies
- cn
- Common Python Backend Architecture Patterns
- get_user_email
- request_context.py
- resizable-table.tsx
- ClusterEnterprisesPage.tsx
- PortalUserSerializer
- button.tsx
- select.tsx
- devices.ts
- sync.py
- Device (Data Model)
- DeviceTable.tsx
- Users Page View — admin-only page listing all portal users
- views.py
- DevicesPage.tsx
- Cluster
- Header.tsx
- django-expert
- compilerOptions
- UntrackedDevicesPage.tsx
- zedcloud.py
- DeviceModelListCreateView
- UserContext.tsx
- Bundle Size Optimization (bundle section)
- views.py
- Enterprise
- email.py
- UsersPage.tsx
- Command
- .patch
- Devices List UI — Master device table with search, filter tabs (All/Available/Reserved), condition/sync/lab/team dropdowns, sortable columns, Export/Import, summary bar
- crypto.py
- apps.py
- Devices List View — Device Table with Rows (no modal)
- 0002_split_condition_field.py
- entrypoint.sh
- views.py
- vite.config.ts
- 0001_initial.py
- 0001_initial.py
- 0001_initial.py
- 0001_initial.py
- 0001_initial.py
- 0001_initial.py
- 0001_initial.py
- 0001_initial.py
- Django 6.0
- 0002_notification_recipient_email.py
- 0002_portalsettings.py
- 0003_add_last_sync_error_code.py
- 0003_notification_force_assigned_kind.py
- 0004_portalsettings_last_sync_at.py
- 0005_portalsettings_sync_running.py
- django-cors-headers 4.4
- django-environ 0.11
- Django REST Framework 3.15
- FetchStatusDialog.tsx
- searchable-select.tsx
- Devices List Page (July 14 session) — Full list view with Notifications, admin user indicator, Export, Import, filter tabs and Name sort column
- Add Device Dialog — modal form with fields: Name (required), Serial Number (required), Model (dropdown), Lab (dropdown with options: Bangalore Lab, Bangalore Office Space, Berlin Lab, SanJose Lab, CoreSite Lab, Home Lab), Team (dropdown), Admin Condition (dropdown: Normal, Out of Order, Temporarily Leased, Dedicated), IDRAC Username, IDRAC Password, Owner Email (combobox); Cancel and Create buttons; also contains nested Add Model sub-dialog trigger
- untracked_views.py
- Devices List View — search, filter (All/Available/Reserved, Team, Lab, Condition), Export and Import buttons
- MoveToInventoryDialog.tsx
- Add Device Dialog — Lab Dropdown with Bangalore Lab Selected
- UI Snapshot: Devices Page with Add Device Dialog (initial, no results)
- Narrow Effect Dependencies
- useColumnResize.ts
- Add Device Dialog — Name Field Filled (intel-nuc-pranav)
- Cache Repeated Function Call Results (module-level Map)
- Use useTransition Over Manual Loading States
- Early Length Check for Array Comparisons
- Extract to Memoized Components
- Server Actions Authentication Rule
- Portal Loading State UI Snapshot
- React Activity Component for Show/Hide State Preservation
- Passive Event Listeners for Scrolling Performance
- Avoid Layout Thrashing (Batch DOM/CSS reads and writes)
- Combine Multiple Array Iterations into One Loop
- Hoist RegExp Creation Outside Render
- Build Index Maps for Repeated O(1) Lookups
- Prevent Hydration Mismatch Without Flickering
- React DOM Resource Hints
- Use Functional setState Updates
- Avoid Duplicate RSC Prop Serialization Rule
- Hoist Static I/O to Module Level Rule
- Parallel Data Fetching with Component Composition Rule
- GitHub Release Changelog Config
- bump_version.sh
- Optimize SVG Precision
- holocron-backend
- UI Snapshot: Empty or Loading State Page
- Notifications Region (UI Snapshot)
- Notifications Panel (Empty State Snapshot)
- Admin View Wireframe (wireframes/admin_index.html)
- Login Page Wireframe (wireframes/login.html)
- Device Modals Wireframe (wireframes/modals.html)

## God Nodes (most connected - your core abstractions)
1. `cn()` - 48 edges
2. `IsPortalUser` - 27 edges
3. `get_user_email()` - 24 edges
4. `IsAdminPortalUser` - 23 edges
5. `Enterprise` - 22 edges
6. `Button` - 20 edges
7. `useUser()` - 19 edges
8. `sync_enterprise()` - 15 edges
9. `DialogHeader()` - 15 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Implementation Plan (PLAN.md)` --references--> `Auto Device Sync Design Spec`  [INFERRED]
  PLAN.md → docs/superpowers/specs/2026-07-13-auto-device-sync-design.md
- `Enterprise` --uses--> `int`  [INFERRED]
  backend/apps/enterprises/models.py → backend/apps/enterprises/sync.py
- `Django 6.0` --rationale_for--> `Django vs FastAPI Trade-off`  [INFERRED]
  backend/requirements.txt → frontend/.agents/skills/python-backend-architecture-review/technology-recommendations.md
- `cryptography 42 (Fernet encryption)` --conceptually_related_to--> `Django Security Checklist (OWASP, CSRF, XSS, SQLi)`  [INFERRED]
  backend/requirements.txt → frontend/.agents/skills/django-expert/references/security-checklist.md
- `httpx 0.27 (HTTP client backend→ZedCloud)` --conceptually_related_to--> `Python Backend Technology Stack Recommendations`  [INFERRED]
  backend/requirements.txt → frontend/.agents/skills/python-backend-architecture-review/technology-recommendations.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Waterfall Elimination Rule Set: parallel, defer, dependencies together prevent sequential async latency** — _agents_skills_vercel_react_best_practices_rules_async_parallel_md, _agents_skills_vercel_react_best_practices_rules_async_defer_await_md, _agents_skills_vercel_react_best_practices_rules_async_dependencies_md, _agents_skills_vercel_react_best_practices_rules_async_api_routes_md [INFERRED 0.85]
- **Bundle Lazy Loading Rule Set: dynamic imports, preload, conditional loading together minimize initial bundle impact** — _agents_skills_vercel_react_best_practices_rules_bundle_dynamic_imports_md, _agents_skills_vercel_react_best_practices_rules_bundle_preload_md, _agents_skills_vercel_react_best_practices_rules_bundle_conditional_md, _agents_skills_vercel_react_best_practices_rules_bundle_defer_third_party_md [INFERRED 0.85]
- **useEffectEvent Advanced Pattern Set: effect-event-deps, use-latest, event-handler-refs all address stable callback identity in effects** — _agents_skills_vercel_react_best_practices_rules_advanced_effect_event_deps_md, _agents_skills_vercel_react_best_practices_rules_advanced_use_latest_md, _agents_skills_vercel_react_best_practices_rules_advanced_event_handler_refs_md, concept_use_effect_event [INFERRED 0.85]
- **JavaScript Array Performance Patterns** — _agents_skills_vercel_react_best_practices_rules_js_combine_iterations_combine_iterations, _agents_skills_vercel_react_best_practices_rules_js_flatmap_filter_flatmap_filter, _agents_skills_vercel_react_best_practices_rules_js_early_exit_early_return, _agents_skills_vercel_react_best_practices_rules_js_length_check_first_length_check_first, _agents_skills_vercel_react_best_practices_rules_js_min_max_loop_min_max_loop [INFERRED 0.85]
- **JavaScript O(1) Lookup Patterns via Map and Set** — _agents_skills_vercel_react_best_practices_rules_js_index_maps_index_maps, _agents_skills_vercel_react_best_practices_rules_js_set_map_lookups_set_map_lookups, _agents_skills_vercel_react_best_practices_rules_js_cache_function_results_cache_function_results [INFERRED 0.85]
- **Static Content Rendering Optimization Patterns** — _agents_skills_vercel_react_best_practices_rules_rendering_hoist_jsx_hoist_jsx, _agents_skills_vercel_react_best_practices_rules_js_hoist_regexp_hoist_regexp, _agents_skills_vercel_react_best_practices_rules_rendering_content_visibility_content_visibility [INFERRED 0.75]
- **React Re-render Performance Patterns** — _agents_skills_vercel_react_best_practices_rules_rerender_memo_md, _agents_skills_vercel_react_best_practices_rules_rerender_no_inline_components_md, _agents_skills_vercel_react_best_practices_rules_rerender_functional_setstate_md, _agents_skills_vercel_react_best_practices_rules_rerender_derived_state_no_effect_md, _agents_skills_vercel_react_best_practices_rules_rerender_split_combined_hooks_md [INFERRED 0.85]
- **React Concurrent Mode Patterns** — _agents_skills_vercel_react_best_practices_rules_rendering_usetransition_loading_md, _agents_skills_vercel_react_best_practices_rules_rerender_transitions_md, _agents_skills_vercel_react_best_practices_rules_rerender_use_deferred_value_md [INFERRED 0.85]
- **Device Availability Gate** — design_md_admin_condition, design_md_sync_condition, design_md_is_available_rule [EXTRACTED 1.00]
- **Enterprise Sync Engine Trio** — design_md_enterprise_sync_engine, design_md_send_nightly_digest, design_md_verify_enterprise_names [EXTRACTED 1.00]
- **Token Expiry Notification Lifecycle** — design_md_enterprise_model, design_md_notification_model, design_md_emit_token_expired [EXTRACTED 1.00]
- **Django Production Stack: Framework + Server + Scheduler** — backend_requirements_django, backend_requirements_gunicorn, backend_requirements_apscheduler, backend_requirements_djangorestframework [INFERRED 0.95]
- **Django Expert Skill with Reference Documentation** — djangoexpert_skill_djangoexpert, djangoexpert_skill_modelsandorm, djangoexpert_skill_drfguidelines, djangoexpert_skill_securitychecklist, djangoexpert_skill_performanceoptimization, djangoexpert_skill_productiondeployment, djangoexpert_skill_testingstrategies [EXTRACTED 1.00]
- **Resilience Patterns: Circuit Breaker + Retry + Event-Driven** — concept_circuit_breaker, concept_retry_exponential_backoff, concept_event_driven_arch, archreview_patterns_commonpatterns [INFERRED 0.85]

## Communities (130 total, 42 thin omitted)

### Community 0 - "Device"
Cohesion: 0.13
Nodes (14): DeviceAdmin, LabAdmin, Device, Lab, Meta, UntrackedDevice, DeviceCreateSerializer, DeviceSerializer (+6 more)

### Community 1 - "DeviceFormModal.tsx"
Cohesion: 0.11
Nodes (27): Cluster, createCluster(), getClusters(), AddClusterModal(), AddClusterModalProps, FormValues, schema, FormValues (+19 more)

### Community 2 - "dependencies"
Cohesion: 0.04
Nodes (44): dependencies, axios, class-variance-authority, clsx, @hookform/resolvers, lucide-react, @radix-ui/react-avatar, @radix-ui/react-checkbox (+36 more)

### Community 3 - "cn"
Cohesion: 0.07
Nodes (28): Alert, AlertDescription, AlertTitle, alertVariants, Checkbox, CopyButton(), CopyButtonProps, CopyableField (+20 more)

### Community 4 - "Common Python Backend Architecture Patterns"
Cohesion: 0.08
Nodes (35): Architecture Review Checklist, Common Python Backend Architecture Patterns, Python Backend Architecture Review README, Python Backend Architecture Review Skill, Python Backend Technology Stack Recommendations, APScheduler 3 (background jobs), cryptography 42 (Fernet encryption), gunicorn 22 (WSGI server) (+27 more)

### Community 5 - "get_user_email"
Cohesion: 0.11
Nodes (27): NotificationAdmin, Meta, Notification, Meta, NotificationSerializer, NotificationListView, NotificationReadAllView, NotificationReadView (+19 more)

### Community 6 - "request_context.py"
Cohesion: 0.15
Nodes (11): Meta, RequestLog, LatencyMiddleware, _normalize_path(), RequestIDMiddleware, bool, RequestIDFilter, get_request_id() (+3 more)

### Community 7 - "resizable-table.tsx"
Cohesion: 0.10
Nodes (19): ColumnConfig, COPYABLE_COLUMNS, ResizableTable, ResizableTableCell, ResizableTableCellProps, ResizableTableContext, ResizableTableContextValue, ResizableTableHeadProps (+11 more)

### Community 8 - "ClusterEnterprisesPage.tsx"
Cohesion: 0.06
Nodes (34): client, getConfig(), PortalConfig, DeviceModel, ClusterWithEnterprises, createCluster(), createEnterprise(), deleteCluster() (+26 more)

### Community 9 - "PortalUserSerializer"
Cohesion: 0.18
Nodes (11): PortalUserAdmin, TeamAdmin, Meta, PortalUser, Team, Meta, PortalUserSerializer, UserDetailView (+3 more)

### Community 10 - "button.tsx"
Cohesion: 0.23
Nodes (15): downloadImportTemplate(), exportDevices(), importDevices(), ImportClusterDialogProps, Button, ButtonProps, buttonVariants, DialogContent (+7 more)

### Community 11 - "select.tsx"
Cohesion: 0.16
Nodes (13): ADMIN_CONDITION_LABELS, SearchBar(), SearchBarProps, SearchParams, SYNC_CONDITION_LABELS, SelectContent, SelectItem, SelectLabel (+5 more)

### Community 12 - "devices.ts"
Cohesion: 0.14
Nodes (12): createDevice(), deleteDevice(), DevicePurpose, DevicesQueryParams, fetchDeviceStatus(), forceAssignDevice(), OwnershipHistoryResponse, releaseDevice() (+4 more)

### Community 13 - "sync.py"
Cohesion: 0.15
Nodes (24): apply_candidates(), _apply_inventory_candidate(), _emit_token_expired(), _extract_connectivity(), _extract_eve_version(), _is_junk_serial(), _is_virtual_device(), _purge_invalid_untracked() (+16 more)

### Community 14 - "Device (Data Model)"
Cohesion: 0.07
Nodes (48): admin_condition Field (Device Condition Flags), Auth Pattern (Header-Based, No Sessions), Auto-Refresh Intervals, GET /api/v1/choices/ Endpoint, Cluster (Data Model), Deployment (Docker + gunicorn + nginx), Device (Data Model), DeviceModel (Data Model) (+40 more)

### Community 15 - "DeviceTable.tsx"
Cohesion: 0.08
Nodes (27): getOwnershipHistory(), OwnershipHistory, ActionsMenuProps, ADMIN_CONDITION_BADGE_STYLES, ADMIN_CONDITION_STYLES, ColId, DeviceTableProps, ExpandPanel() (+19 more)

### Community 16 - "Users Page View — admin-only page listing all portal users"
Cohesion: 0.07
Nodes (36): Active Filter Chip — Lab: Berlin Lab, Active Filter Chip — Team: EVE, Add Device Button — CTA in empty state, Clear Search and Filters Button — shown in no-results state, Device List Table Columns — Owner, Status, Comment/Purpose, Actions, Empty State — No devices yet (fresh install), Filter Bar — All/Available/Reserved tabs + active Team and Lab filter chips, Load Error State — API / server error (HTTP 500) (+28 more)

### Community 17 - "views.py"
Cohesion: 0.27
Nodes (16): APIView, str, PortalSettings, EnterpriseReadSerializer, EnterpriseUpdateSerializer, ClusterExportView, ClusterImportView, EnterpriseDetailView (+8 more)

### Community 18 - "DevicesPage.tsx"
Cohesion: 0.15
Nodes (14): getDevices(), DeviceFormModal(), DeviceTable(), ExportImportPanel(), FloatingAddButton(), Header(), initials(), NotificationBell() (+6 more)

### Community 19 - "Cluster"
Cohesion: 0.24
Nodes (7): ClusterAdmin, Cluster, ClusterSerializer, Meta, ClusterDetailView, ClusterEnterpriseListCreateView, ClusterListCreateView

### Community 20 - "Header.tsx"
Cohesion: 0.22
Nodes (11): FabItem, FloatingAddButtonProps, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator (+3 more)

### Community 21 - "django-expert"
Cohesion: 0.38
Nodes (9): computedHash, skillPath, source, sourceType, skills, django-expert, python-backend, Python Backend Architecture Review (+1 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleDetection (+9 more)

### Community 23 - "UntrackedDevicesPage.tsx"
Cohesion: 0.11
Nodes (20): exportOnlineUntrackedDevices(), getUntrackedDevices(), moveToInventory(), UntrackedDevice, UntrackedFilters, MoveToInventoryDialog(), Props, Badge() (+12 more)

### Community 24 - "zedcloud.py"
Cohesion: 0.21
Nodes (11): _fetch_username(), Call /v1/users/self and return the username. Logs a warning and returns '' on an, fetch_device_status(), fetch_enterprise_devices(), fetch_enterprise_self(), fetch_user_self(), str, Call /api/v1/users/self. Returns {'username': '...'}. (+3 more)

### Community 25 - "DeviceModelListCreateView"
Cohesion: 0.26
Nodes (5): DeviceModelAdmin, DeviceModel, DeviceModelSerializer, Meta, DeviceModelListCreateView

### Community 26 - "UserContext.tsx"
Cohesion: 0.09
Nodes (15): PortalUser, ClusterEnterprisesPage, ConfirmReservationPage, DevicesPage, LoginPage, UntrackedDevicesPage, UsersPage, ErrorBoundary (+7 more)

### Community 27 - "Bundle Size Optimization (bundle section)"
Cohesion: 0.10
Nodes (29): React Best Practices AGENTS.md (compiled output), React Best Practices README, Rule Sections Registry, Rule File Template, Do Not Put Effect Events in Dependency Arrays, Store Event Handlers in Refs, Initialize App Once, Not Per Mount, useEffectEvent for Stable Callback Refs (+21 more)

### Community 28 - "views.py"
Cohesion: 0.19
Nodes (10): DeviceDetailView, DeviceForceAssignView, DeviceListCreateView, DeviceOwnershipHistoryView, DevicePurposeView, DeviceReleaseView, DeviceReserveView, DeviceStatusView (+2 more)

### Community 29 - "Enterprise"
Cohesion: 0.27
Nodes (6): EnterpriseAdmin, Enterprise, Meta, EnterpriseCreateSerializer, Meta, Accepts bearer_token only — name is fetched from ZedCloud by the view.

### Community 30 - "email.py"
Cohesion: 0.38
Nodes (9): _send(), send_force_assign_notice(), send_nightly_digest(), send_out_of_order_alert(), send_reservation_approved(), send_reservation_overridden(), send_reservation_rejected(), send_reservation_request() (+1 more)

### Community 31 - "UsersPage.tsx"
Cohesion: 0.21
Nodes (10): createUser(), exportUsers(), getUsers(), importUsers(), updateUser(), UserImportDialog(), CreateFormValues, createSchema (+2 more)

### Community 32 - "Command"
Cohesion: 0.25
Nodes (3): Command, Command, BaseCommand

### Community 33 - ".patch"
Cohesion: 0.27
Nodes (4): get_scheduler(), is_sync_running(), _fetch_username(), Call /v1/users/self and return the username. Logs a warning and returns '' on an

### Community 34 - "Devices List UI — Master device table with search, filter tabs (All/Available/Reserved), condition/sync/lab/team dropdowns, sortable columns, Export/Import, summary bar"
Cohesion: 0.15
Nodes (17): Devices List UI — Master device table with search, filter tabs (All/Available/Reserved), condition/sync/lab/team dropdowns, sortable columns, Export/Import, summary bar, Import Devices Dialog — CSV/JSON file upload dialog with import mode selector (Create only / skip existing), max 200 devices, Notifications Live Region — Transient ARIA live region rendered before full page load, Notifications Panel — Expandable admin notification tray showing token-expired, sync-error, name-mismatch, enterprise-inactive alerts, Holocron Portal — Notifications Live Region (transient snapshot), Devices List View — Full snapshot with all columns, filters, and summary bar, Devices List View — Available filter active (Available tab selected), Devices List View — Notifications panel expanded (empty, no notifications) (+9 more)

### Community 35 - "crypto.py"
Cohesion: 0.33
Nodes (7): Post-import trigger: for any enterprise not yet name-verified, call ZedCloud and, verify_enterprise_names(), decrypt(), encrypt(), _get_fernet(), str, bytes

### Community 36 - "apps.py"
Cohesion: 0.25
Nodes (5): AppConfig, EnterprisesConfig, _thread_excepthook(), NotificationsConfig, ExceptHookArgs

### Community 37 - "Devices List View — Device Table with Rows (no modal)"
Cohesion: 0.13
Nodes (15): Devices List View — Device Table with Rows (no modal), Loading State — Portal Loading Spinner, Devices Page with Add Device Dialog (empty form), Add Device Dialog — Empty Form Opened, Devices List View — No Devices Match Filters State, Add Device Dialog — Name Field Active (empty), Add Device Dialog — Name and Serial Number Filled, Add Device Dialog — Partial Form Fill (name+serial, no model) (+7 more)

### Community 40 - "views.py"
Cohesion: 0.12
Nodes (19): ChoicesView, ExportView, ImportTemplateView, ImportView, LatencyView, _normalize_admin_condition(), _normalize_key(), _parse_csv() (+11 more)

### Community 90 - "FetchStatusDialog.tsx"
Cohesion: 0.18
Nodes (11): Choices, EnterpriseChoice, getChoices(), Device, DeviceFormModalProps, FetchStatusDialogProps, FormValues, schema (+3 more)

### Community 91 - "searchable-select.tsx"
Cohesion: 0.27
Nodes (5): SearchableSelect(), SearchableSelectOption, SearchableSelectProps, TruncatingTitleLabel(), useIsTruncated()

### Community 92 - "Devices List Page (July 14 session) — Full list view with Notifications, admin user indicator, Export, Import, filter tabs and Name sort column"
Cohesion: 0.22
Nodes (10): Add Device Dialog — UI snapshot capturing the 'Add Device' modal dialog on the /devices page, with Cancel and Create buttons, Add Model Dialog — UI snapshot capturing the 'Add Model' modal dialog on the /devices page, with Cancel and Create buttons, Devices List Page — Loading/empty state snapshot on the /devices route, no content rendered yet, Devices List Page — Full loaded state with Notifications, user avatar, Export, Import, filter tabs (All/Available/Reserved) and sortable Name column, Holocron Login / Sign-In Page — UI snapshot showing the 'Holocron' heading and Sign In button with Google OAuth user shown, Devices List Page (July 14 session) — Full list view with Notifications, admin user indicator, Export, Import, filter tabs and Name sort column, Reserve Device Dialog — UI snapshot of the 'Reserve Andrew-walnut' modal with Cancel and Reserve buttons on the /devices page, Users Management Page — UI snapshot showing the Users heading with Export, Import, Edit user, and Add buttons; admin-only view (+2 more)

### Community 93 - "Add Device Dialog — modal form with fields: Name (required), Serial Number (required), Model (dropdown), Lab (dropdown with options: Bangalore Lab, Bangalore Office Space, Berlin Lab, SanJose Lab, CoreSite Lab, Home Lab), Team (dropdown), Admin Condition (dropdown: Normal, Out of Order, Temporarily Leased, Dedicated), IDRAC Username, IDRAC Password, Owner Email (combobox); Cancel and Create buttons; also contains nested Add Model sub-dialog trigger"
Cohesion: 0.28
Nodes (9): Devices List Page — baseline state with table (Name, Serial No, Cluster, Name in Cluster, Owner, Status, Comment, Actions columns), search box, All/Available/Reserved toggle, All Teams/All Labs/All Conditions filter dropdowns, Export and Import toolbar buttons, Add Device Dialog — modal form with fields: Name (required), Serial Number (required), Model (dropdown), Lab (dropdown with options: Bangalore Lab, Bangalore Office Space, Berlin Lab, SanJose Lab, CoreSite Lab, Home Lab), Team (dropdown), Admin Condition (dropdown: Normal, Out of Order, Temporarily Leased, Dedicated), IDRAC Username, IDRAC Password, Owner Email (combobox); Cancel and Create buttons; also contains nested Add Model sub-dialog trigger, Add Model Sub-Dialog — modal launched from within the Add Device dialog; contains Model Name text field (placeholder: e.g. Dell R750) and a Create button; used to create a new device model inline during device creation workflow, Add Device Dialog — Lab dropdown open state showing available lab options: Bangalore Lab, Bangalore Office Space, Berlin Lab, SanJose Lab, CoreSite Lab, Home Lab, Add Device Dialog — Admin Condition dropdown open state showing available values: Normal, Out of Order, Temporarily Leased, Dedicated, Devices List Page — post-creation state with 'Device created' toast notification shown in Notifications panel (alt+T); table updated with newly created device; Add Device dialog re-opened for next device creation (SJC-Dell-R650-XS flow), Devices List Page — state showing 'Model Dell-custom-blade created' notification in the Notifications panel; Add Device dialog still open in foreground, illustrating that model creation notification appears while device form remains open, Devices List Page — post-multiple-device-creation state showing populated table rows including BER-Dell-R360 (serial 1LPN994); table columns: Expand, Name, Serial No, Cluster, Name in Cluster, Owner, Status, Comment, Actions (+1 more)

### Community 94 - "untracked_views.py"
Cohesion: 0.42
Nodes (4): MoveToInventoryView, APIView, UntrackedDeviceExportView, UntrackedDeviceListView

### Community 95 - "Devices List View — search, filter (All/Available/Reserved, Team, Lab, Condition), Export and Import buttons"
Cohesion: 0.28
Nodes (9): Device Portal Login / Account Selection View, Devices List View — search, filter (All/Available/Reserved, Team, Lab, Condition), Export and Import buttons, Add Device Dialog — fields: Name, Serial Number, Lab, Cluster, Name in Cluster, Team; overlay on Devices view, Import Devices Dialog — CSV/JSON file upload, Import Mode selector (Create only), Import button, Devices View — All Conditions filter dropdown expanded (options: All Conditions, Normal, Out of Order, Temporarily Leased, Dedicated), Users List View — table with Name, Email, Team, Role columns; user row: Varuna Jayachandra, admin, Add User Dialog — fields: Full Name, Email; Create button; overlay on Users view, Devices List View (post-navigation with device data loaded) — same filter bar; ref=f8e24 heading (+1 more)

### Community 96 - "MoveToInventoryDialog.tsx"
Cohesion: 0.38
Nodes (5): createModel(), DeviceModel, getModels(), AddModelModal(), AddModelModalProps

### Community 97 - "Add Device Dialog — Lab Dropdown with Bangalore Lab Selected"
Cohesion: 0.29
Nodes (7): Add Device Dialog — Lab Selection Dropdown Active, Add Device Dialog — Lab Dropdown with Bangalore Lab Selected, Add Device Dialog — Model Dell-XC640-10-CORE Selected, Add Device Dialog — Full Form Filled (Bangalore Lab, Dell model), Add Device Dialog + Add Cluster Dialog Both Open, Add Device Dialog — Failed to Create Cluster Notification, Add Device Dialog — Bangalore Lab Selected, All Fields Visible

### Community 98 - "UI Snapshot: Devices Page with Add Device Dialog (initial, no results)"
Cohesion: 0.29
Nodes (7): UI Snapshot: Devices Page with Add Device Dialog (initial, no results), UI Snapshot: Devices Page with Add Device Dialog and Failure Notification Toast, UI Snapshot: Devices Page with Device Table (columns: Expand, Name, Serial No, Cluster, Name in Cluster, Owner, Status, Comment, Actions), UI Snapshot: Devices Add Device Dialog with Condition Dropdown Expanded, UI Snapshot: Devices Add Device Dialog with Nested Add Model Dialog, UI Snapshot: Devices Add Device Dialog with Lab Dropdown Expanded, UI Snapshot: Devices Table with Device Row (Reserve/Release/Refresh actions, status Unknown, needs repair badge)

### Community 99 - "Narrow Effect Dependencies"
Cohesion: 0.33
Nodes (6): Narrow Effect Dependencies, Subscribe to Derived Boolean State, Calculate Derived State During Rendering, Put Interaction Logic in Event Handlers, Split Combined Hook Computations, Use after() for Non-Blocking Server Operations

### Community 100 - "useColumnResize.ts"
Cohesion: 0.40
Nodes (5): ColumnConfig, migrateStorage(), useColumnResize(), UseColumnResizeOptions, UseColumnResizeReturn

### Community 101 - "Add Device Dialog — Name Field Filled (intel-nuc-pranav)"
Cohesion: 0.33
Nodes (6): Devices List View — Base State (no dialog), Devices List View — Expanded Row / More Rows Loaded, Add Device Dialog — Add Model Sub-Dialog Open, Add Device Dialog — Name Field Filled (intel-nuc-pranav), Add Device Dialog — Condition Dropdown Open (Normal selected), Add Device Dialog — Lab Dropdown Open (Bangalore Lab option visible)

### Community 102 - "Cache Repeated Function Call Results (module-level Map)"
Cohesion: 0.40
Nodes (5): localStorage Versioning and Data Minimization, SWR Request Deduplication, Cache Repeated Function Call Results (module-level Map), Cache Property Access in Loops, Cache Storage API Calls (localStorage, sessionStorage, cookies)

### Community 103 - "Use useTransition Over Manual Loading States"
Cohesion: 0.40
Nodes (5): Use useTransition Over Manual Loading States, Defer State Reads to Usage Point, Use Transitions for Non-Urgent Updates, Use useDeferredValue for Expensive Derived Renders, Use useRef for Transient Values

### Community 104 - "Early Length Check for Array Comparisons"
Cohesion: 0.50
Nodes (4): Early Return from Functions, Early Length Check for Array Comparisons, Use Loop for Min/Max Instead of Sort, Use toSorted() Instead of sort() for Immutability

### Community 105 - "Extract to Memoized Components"
Cohesion: 0.50
Nodes (4): Extract to Memoized Components, Extract Default Non-primitive Parameter to Constant in Memoized Components, Don't Define Components Inside Components, Do Not Wrap Simple Primitive Expressions in useMemo

### Community 106 - "Server Actions Authentication Rule"
Cohesion: 0.50
Nodes (4): Server Actions Authentication Rule, Cross-Request LRU Caching Rule, Per-Request Deduplication with React.cache() Rule, Web Design Guidelines Skill

### Community 107 - "Portal Loading State UI Snapshot"
Cohesion: 0.50
Nodes (4): Portal Devices Page UI Snapshot, Portal Loading State UI Snapshot, Portal Login Page UI Snapshot, Portal Login User Picker Dialog UI Snapshot

### Community 108 - "React Activity Component for Show/Hide State Preservation"
Cohesion: 0.67
Nodes (3): React Activity Component for Show/Hide State Preservation, Explicit Conditional Rendering (avoid && with falsy numbers), CSS content-visibility for Long List Rendering Performance

## Knowledge Gaps
- **294 isolated node(s):** `Migration`, `Meta`, `Migration`, `Migration`, `Migration` (+289 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `DeviceFormModal.tsx`, `resizable-table.tsx`, `ClusterEnterprisesPage.tsx`, `button.tsx`, `select.tsx`, `DeviceTable.tsx`, `DevicesPage.tsx`, `Header.tsx`, `UntrackedDevicesPage.tsx`, `searchable-select.tsx`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `get_user_email()` connect `get_user_email` to `.patch`, `PortalUserSerializer`, `sync.py`, `Cluster`, `zedcloud.py`, `DeviceModelListCreateView`, `views.py`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `IsPortalUser` connect `views.py` to `DeviceModelListCreateView`, `Cluster`, `get_user_email`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 20 inferred relationships involving `IsPortalUser` (e.g. with `ClusterDetailView` and `ClusterEnterpriseListCreateView`) actually correct?**
  _`IsPortalUser` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `IsAdminPortalUser` (e.g. with `ClusterDetailView` and `ClusterEnterpriseListCreateView`) actually correct?**
  _`IsAdminPortalUser` has 16 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Migration`, `Meta`, `Migration` to the rest of the system?**
  _294 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Device` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._