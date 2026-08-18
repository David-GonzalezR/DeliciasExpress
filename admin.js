document.addEventListener('DOMContentLoaded', () => {

    const config = {
        supabaseUrl: 'https://sjoytwcrdewealudjxep.supabase.co',
        supabaseKey: 'sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF'
    };

    const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

    // --- STATUS FLOW ---
    const STATUS_FLOW = ['recibido', 'preparando'];
    const STATUS_LABELS = {
        recibido: 'Recibido',
        preparando: 'Preparando',
        despachado: 'Despachado',
        buscando_domiciliario: 'Buscando domiciliario',
        en_camino: 'En camino',
        entregado: 'Entregado',
        cancelado: 'Cancelado'
    };
    const NEXT_ACTION_LABEL = {
        recibido: 'Marcar Preparando',
        preparando: 'Marcar Despachado'
    };

    // --- DOM ---
    const loginScreen = document.getElementById('login-screen');
    const loginForm = document.getElementById('login-form');
    const loginEmail = document.getElementById('login-email');
    const loginPassword = document.getElementById('login-password');
    const loginSubmitBtn = document.getElementById('login-submit-btn');
    const loginError = document.getElementById('login-error');
    const dashboard = document.getElementById('dashboard');
    const logoutBtn = document.getElementById('logout-btn');
    const ordersContainer = document.getElementById('orders-container');
    const ordersEmptyMessage = document.getElementById('orders-empty-message');
    const statusFilterButtons = document.querySelectorAll('.status-filter-btn');

    // Productos
    const sidebarButtons = document.querySelectorAll('.sidebar-btn');
    const pedidosView = document.getElementById('pedidos-view');
    const productosView = document.getElementById('productos-view');
    const newProductBtn = document.getElementById('new-product-btn');
    const productsContainer = document.getElementById('products-container');
    const productsEmptyMessage = document.getElementById('products-empty-message');
    const productModal = document.getElementById('product-modal');
    const productModalTitle = document.getElementById('product-modal-title');
    const productForm = document.getElementById('product-form');
    const productNameInput = document.getElementById('product-name');
    const productDescriptionInput = document.getElementById('product-description');
    const productDetailedDescriptionInput = document.getElementById('product-detailed-description');
    const productPriceInput = document.getElementById('product-price');
    const productOfferPriceInput = document.getElementById('product-offer-price');
    const productCategoryInput = document.getElementById('product-category');
    const productStockInput = document.getElementById('product-stock');
    const productImageInput = document.getElementById('product-image');
    const productImageFileInput = document.getElementById('product-image-file');
    const productImagePreview = document.getElementById('product-image-preview');
    const productIsOfferInput = document.getElementById('product-is-offer');
    const productIsNewInput = document.getElementById('product-is-new');
    const productNewCategoryContainer = document.getElementById('new-category-container');
    const productNewCategoryInput = document.getElementById('product-new-category');
    const closeProductModalBtn = document.getElementById('close-product-modal-btn');
    const cancelProductBtn = document.getElementById('cancel-product-btn');
    const saveProductBtn = document.getElementById('save-product-btn');

    // Ofertas Relámpago
    const ofertasView = document.getElementById('ofertas-view');
    const newOfferBtn = document.getElementById('new-offer-btn');
    const offersContainer = document.getElementById('offers-container');
    const offersEmptyMessage = document.getElementById('offers-empty-message');
    const offerModal = document.getElementById('offer-modal');
    const offerForm = document.getElementById('offer-form');
    const offerProductSelect = document.getElementById('offer-product');
    const offerDiscountInput = document.getElementById('offer-discount');
    const offerDurationInput = document.getElementById('offer-duration');
    const closeOfferModalBtn = document.getElementById('close-offer-modal-btn');
    const cancelOfferBtn = document.getElementById('cancel-offer-btn');
    const saveOfferBtn = document.getElementById('save-offer-btn');

    // Domiciliarios
    const domiciliariosView = document.getElementById('domiciliarios-view');
    const riderSearchEmail = document.getElementById('rider-search-email');
    const riderPromoteBtn = document.getElementById('rider-promote-btn');
    const ridersContainer = document.getElementById('riders-container');
    const ridersEmptyMessage = document.getElementById('riders-empty-message');
    // Modal crear domiciliario
    const newRiderBtn = document.getElementById('new-rider-btn');
    const riderModal = document.getElementById('rider-modal');
    const riderForm = document.getElementById('rider-form');
    const riderNameInput = document.getElementById('rider-name');
    const riderPhoneInput = document.getElementById('rider-phone');
    const riderEmailInput = document.getElementById('rider-email');
    const riderPasswordInput = document.getElementById('rider-password');
    const toggleRiderPasswordBtn = document.getElementById('toggle-rider-password');
    const riderFormError = document.getElementById('rider-form-error');
    const saveRiderBtn = document.getElementById('save-rider-btn');
    const cancelRiderBtn = document.getElementById('cancel-rider-btn');
    const closeRiderModalBtn = document.getElementById('close-rider-modal-btn');

    let allOrders = [];
    let currentFilter = 'activos';
    let ordersChannel = null;
    let allProducts = [];
    let editingProductId = null;
    let allOffers = [];
    let pendingImageFile = null;
    let riderNamesCache = {};

    // --- AUTH ---
    async function checkSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            await verifyAdminAccess();
        } else {
            showLogin();
        }
    }

    async function verifyAdminAccess() {
        try {
            const { data: role, error } = await supabase.rpc('get_user_role');
            if (error) throw error;
            
            if (role === 'admin') {
                showDashboard();
            } else {
                await supabase.auth.signOut();
                showLogin();
                loginError.textContent = 'Acceso denegado. Se requieren permisos de administrador.';
            }
        } catch (error) {
            console.error('Error verificando rol:', error);
            await supabase.auth.signOut();
            showLogin();
            loginError.textContent = 'Error de autorización.';
        }
    }

    function showLogin() {
        loginScreen.style.display = 'flex';
        dashboard.style.display = 'none';
    }

    function showDashboard() {
        loginScreen.style.display = 'none';
        dashboard.style.display = 'block';
        loadOrders();
        subscribeToOrders();
        loadAdminProducts();
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = 'Entrando...';

        const { error } = await supabase.auth.signInWithPassword({
            email: loginEmail.value.trim(),
            password: loginPassword.value
        });

        if (error) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = 'Entrar';
            loginError.textContent = 'Correo o contraseña incorrectos.';
            return;
        }
        
        await verifyAdminAccess();
        
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Entrar';
    });

    logoutBtn.addEventListener('click', async () => {
        if (ordersChannel) supabase.removeChannel(ordersChannel);
        await supabase.auth.signOut();
        showLogin();
    });

    // --- CARGA DE PEDIDOS ---
    async function loadRiderNames(riderIds) {
        const unique = [...new Set((riderIds || []).filter(Boolean))].filter(id => !riderNamesCache[id]);
        if (unique.length === 0) return;
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', unique);
        if (!error && data) {
            data.forEach(p => { riderNamesCache[p.id] = p.full_name || 'Domiciliario'; });
        }
    }

    async function loadOrders() {
        ordersEmptyMessage.style.display = 'block';
        ordersEmptyMessage.textContent = 'Cargando pedidos...';

        const { data, error } = await supabase
            .from('orders')
            .select(`
                id, delivery_address, status, total, created_at,
                assigned_rider_id, delivery_requested_at, delivered_at,
                delivery_lat, delivery_lng, customer_phone,
                order_items ( id, product_name, quantity, unit_price, customizations, instructions )
            `)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error('Error cargando pedidos:', error);
            ordersEmptyMessage.textContent = 'No se pudieron cargar los pedidos.';
            return;
        }

        allOrders = data || [];
        await loadRiderNames(allOrders.map(o => o.assigned_rider_id));
        renderOrders();
    }

    function subscribeToOrders() {
        if (ordersChannel) supabase.removeChannel(ordersChannel);

        ordersChannel = supabase
            .channel('admin-orders-changes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
                const { data } = await supabase
                    .from('orders')
                    .select(`id, delivery_address, status, total, created_at, order_items ( id, product_name, quantity, unit_price, customizations, instructions )`)
                    .eq('id', payload.new.id)
                    .single();
                if (data) {
                    allOrders.unshift(data);
                    renderOrders();
                    playNewOrderChime();
                }
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
                const idx = allOrders.findIndex(o => o.id === payload.new.id);
                if (idx !== -1) {
                    allOrders[idx] = { ...allOrders[idx], ...payload.new };
                    renderOrders();
                    if (payload.new.assigned_rider_id && !riderNamesCache[payload.new.assigned_rider_id]) {
                        loadRiderNames([payload.new.assigned_rider_id]).then(() => renderOrders());
                    }
                }
            })
            .subscribe();
    }

    function playNewOrderChime() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
        } catch (e) { /* silencioso si el navegador bloquea audio */ }
    }

    // --- FILTROS ---
    statusFilterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            statusFilterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            renderOrders();
        });
    });

    function getFilteredOrders() {
        if (currentFilter === 'todos') return allOrders;
        if (currentFilter === 'activos') return allOrders.filter(o => ['recibido', 'preparando', 'despachado', 'buscando_domiciliario', 'en_camino'].includes(o.status));
        return allOrders.filter(o => o.status === currentFilter);
    }

    // --- RENDER ---
    function renderOrders() {
        const filtered = getFilteredOrders();
        ordersContainer.querySelectorAll('.order-card').forEach(el => el.remove());

        if (filtered.length === 0) {
            ordersEmptyMessage.style.display = 'block';
            ordersEmptyMessage.textContent = 'No hay pedidos en esta categoría.';
            return;
        }
        ordersEmptyMessage.style.display = 'none';

        filtered.forEach(order => {
            ordersContainer.appendChild(buildOrderCard(order));
        });
    }

    function buildOrderCard(order) {
        const card = document.createElement('div');
        card.className = `order-card status-${order.status}`;

        const shortId = order.id.slice(0, 8).toUpperCase();
        const time = new Date(order.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        const itemsHtml = (order.order_items || []).map(item => {
            let extras = '';
            if (item.customizations && item.customizations.length > 0) {
                extras += `<div class="item-extras">Extras: ${item.customizations.map(c => c.name).join(', ')}</div>`;
            }
            if (item.instructions) {
                extras += `<div class="item-extras"><i>${item.instructions}</i></div>`;
            }
            return `<li><strong>${item.quantity}x</strong> ${item.product_name}${extras}</li>`;
        }).join('');

        let actionsHtml = '';
        if (STATUS_FLOW.includes(order.status)) {
            actionsHtml += `<button class="btn btn-status-advance" data-action="advance" data-id="${order.id}" data-current="${order.status}">${NEXT_ACTION_LABEL[order.status]}</button>`;
        }
        if (order.status === 'despachado') {
            actionsHtml += `<button class="btn btn-status-advance" data-action="request-delivery" data-id="${order.id}">
                <i class="fas fa-motorcycle"></i> Pedir Domicilio
            </button>`;
        }
        if (order.status === 'buscando_domiciliario' && !order.assigned_rider_id) {
            actionsHtml += `<button class="btn btn-status-cancel" data-action="cancel-delivery-request" data-id="${order.id}">Cancelar solicitud de domicilio</button>`;
        }
        if (order.status !== 'entregado' && order.status !== 'cancelado') {
            actionsHtml += `<button class="btn btn-status-cancel" data-action="cancel" data-id="${order.id}">Cancelar</button>`;
        }

        const riderInfo = order.assigned_rider_id
            ? `<div class="order-card-rider"><i class="fas fa-motorcycle"></i> ${riderNamesCache[order.assigned_rider_id] || 'Domiciliario asignado'}</div>`
            : '';
        const phoneInfo = order.customer_phone
            ? `<div class="order-card-rider"><i class="fas fa-phone"></i> ${order.customer_phone}</div>`
            : '';
        const mapsLink = buildMapsLink(order);

        card.innerHTML = `
            <div class="order-card-header">
                <div>
                    <div class="order-card-id">#${shortId}</div>
                    <div class="order-card-time">${time}</div>
                </div>
                <span class="order-status-badge">${STATUS_LABELS[order.status] || order.status}</span>
            </div>
            <div class="order-card-address"><i class="fas fa-location-dot"></i> ${order.delivery_address}</div>
            ${riderInfo}
            ${phoneInfo}
            <ul class="order-card-items">${itemsHtml}</ul>
            <div class="order-card-total"><span>Total</span><span>${formatPrice(order.total)}</span></div>
            <div class="order-card-actions">${actionsHtml}</div>
            ${mapsLink ? `<div class="order-card-actions"><a class="btn btn-secondary" href="${mapsLink}" target="_blank" rel="noopener"><i class="fas fa-map-location-dot"></i> Ver en Google Maps</a></div>` : ''}
        `;
        return card;
    }

    function buildMapsLink(order) {
        if (order.delivery_lat && order.delivery_lng) {
            return `https://www.google.com/maps?q=${order.delivery_lat},${order.delivery_lng}`;
        }
        if (order.delivery_address) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`;
        }
        return null;
    }

    // --- ACCIONES SOBRE PEDIDOS ---
    ordersContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        const orderId = btn.dataset.id;
        btn.disabled = true;

        if (btn.dataset.action === 'advance') {
            const currentStatus = btn.dataset.current;
            const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(currentStatus) + 1];
            await updateOrderStatus(orderId, nextStatus);
        } else if (btn.dataset.action === 'request-delivery') {
            const { data, error } = await supabase.rpc('request_delivery', { p_order_id: orderId });
            if (error || !(data && data.ok)) {
                alert('No se pudo solicitar el domiciliario. Intenta de nuevo.');
                btn.disabled = false;
                return;
            }
            const idx = allOrders.findIndex(o => o.id === orderId);
            if (idx !== -1) { allOrders[idx].status = 'buscando_domiciliario'; renderOrders(); }
        } else if (btn.dataset.action === 'cancel-delivery-request') {
            if (!confirm('¿Cancelar la solicitud de domicilio? El pedido volverá a "Despachado".')) {
                btn.disabled = false;
                return;
            }
            const { data, error } = await supabase.rpc('cancel_delivery_request', { p_order_id: orderId });
            if (error || !(data && data.ok)) {
                alert('No se pudo cancelar la solicitud. Intenta de nuevo.');
                btn.disabled = false;
                return;
            }
            const idx = allOrders.findIndex(o => o.id === orderId);
            if (idx !== -1) { allOrders[idx].status = 'despachado'; allOrders[idx].delivery_requested_at = null; renderOrders(); }
        } else if (btn.dataset.action === 'cancel') {
            if (confirm('¿Cancelar este pedido?')) {
                await updateOrderStatus(orderId, 'cancelado');
            } else {
                btn.disabled = false;
            }
        }
    });

    async function updateOrderStatus(orderId, newStatus) {
        const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
        if (error) {
            console.error('Error actualizando estado:', error);
            alert('No se pudo actualizar el pedido. Intenta de nuevo.');
            return;
        }
        const idx = allOrders.findIndex(o => o.id === orderId);
        if (idx !== -1) {
            allOrders[idx].status = newStatus;
            renderOrders();
        }
    }

    // --- NAVEGACIÓN Y MODAL DE PRODUCTOS ---
    sidebarButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            showView(btn.dataset.view);
            if (btn.dataset.view === 'productos' && allProducts.length === 0) loadAdminProducts();
            if (btn.dataset.view === 'ofertas' && allOffers.length === 0) loadOffers();
            if (btn.dataset.view === 'domiciliarios') loadRiders();
        });
    });
    newProductBtn.addEventListener('click', () => openProductModal(null));
    closeProductModalBtn.addEventListener('click', closeProductModal);
    cancelProductBtn.addEventListener('click', closeProductModal);
    productForm.addEventListener('submit', saveProduct);
    productImageFileInput.addEventListener('change', handleProductImageFile);
    productCategoryInput.addEventListener('change', () => {
        if (productCategoryInput.value === '__new__') {
            productNewCategoryContainer.style.display = 'block';
            productNewCategoryInput.value = '';
            productNewCategoryInput.focus();
            productNewCategoryInput.required = true;
        } else {
            productNewCategoryContainer.style.display = 'none';
            productNewCategoryInput.required = false;
        }
    });
    productModal.addEventListener('click', (e) => {
        if (e.target === productModal) closeProductModal();
    });
    productsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'edit-product') {
            const product = allProducts.find(p => p.id === btn.dataset.id);
            if (product) openProductModal(product);
        } else if (btn.dataset.action === 'delete-product') {
            deleteProduct(btn.dataset.id);
        }
    });

    // Ofertas
    newOfferBtn.addEventListener('click', openOfferModal);
    closeOfferModalBtn.addEventListener('click', () => offerModal.style.display = 'none');
    cancelOfferBtn.addEventListener('click', () => offerModal.style.display = 'none');
    offerForm.addEventListener('submit', saveOffer);
    offerModal.addEventListener('click', (e) => {
        if (e.target === offerModal) offerModal.style.display = 'none';
    });
    offersContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'offer-email') {
            sendOfferEmail(btn.dataset.id);
        } else if (btn.dataset.action === 'offer-end') {
            terminateOffer(btn.dataset.id);
        }
    });

    // Modal crear domiciliario
    newRiderBtn.addEventListener('click', () => openRiderModal());
    closeRiderModalBtn.addEventListener('click', closeRiderModal);
    cancelRiderBtn.addEventListener('click', closeRiderModal);
    riderModal.addEventListener('click', (e) => { if (e.target === riderModal) closeRiderModal(); });
    riderForm.addEventListener('submit', createRider);
    toggleRiderPasswordBtn.addEventListener('click', () => {
        const isText = riderPasswordInput.type === 'text';
        riderPasswordInput.type = isText ? 'password' : 'text';
        toggleRiderPasswordBtn.querySelector('i').className = isText ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    // --- NAVEGACIÓN ENTRE VISTAS ---
    function showView(view) {
        sidebarButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
        pedidosView.style.display = view === 'pedidos' ? 'block' : 'none';
        productosView.style.display = view === 'productos' ? 'block' : 'none';
        ofertasView.style.display = view === 'ofertas' ? 'block' : 'none';
        domiciliariosView.style.display = view === 'domiciliarios' ? 'block' : 'none';
    }

    // --- GESTIÓN DE DOMICILIARIOS ---
    async function loadRiders() {
        ridersEmptyMessage.style.display = 'block';
        ridersEmptyMessage.textContent = 'Cargando domiciliarios...';

        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, phone, email, is_available, role')
            .eq('role', 'domiciliario');

        if (error) {
            console.error('Error cargando domiciliarios:', error);
            ridersEmptyMessage.textContent = 'No se pudieron cargar los domiciliarios.';
            return;
        }

        ridersContainer.querySelectorAll('.product-card').forEach(el => el.remove());
        if (!data || data.length === 0) {
            ridersEmptyMessage.style.display = 'block';
            ridersEmptyMessage.textContent = 'No hay domiciliarios. Promueve a un usuario registrado con su correo.';
            return;
        }
        ridersEmptyMessage.style.display = 'none';
        data.forEach(rider => ridersContainer.appendChild(buildRiderCard(rider)));
    }

    function buildRiderCard(rider) {
        const card = document.createElement('div');
        card.className = 'product-card rider-card';

        const availabilityBadge = rider.is_available
            ? '<span class="product-badge product-badge-offer">Disponible</span>'
            : '<span class="product-badge product-badge-new">No disponible</span>';

        card.innerHTML = `
            <div class="product-card-body">
                <h4 class="product-card-name"><i class="fas fa-motorcycle"></i> ${rider.full_name || 'Sin nombre'}</h4>
                <div class="product-badges">${availabilityBadge}</div>
                <span class="product-card-stock">${rider.phone ? `<i class="fas fa-phone"></i> ${rider.phone}` : 'Sin teléfono registrado'}</span>
                <span class="product-card-stock">${rider.email ? `<i class="fas fa-envelope"></i> ${rider.email}` : 'Sin correo registrado'}</span>
                <div class="product-actions">
                    <button class="btn btn-delete" data-action="demote-rider" data-id="${rider.id}"><i class="fas fa-user-minus"></i> Quitar rol de domiciliario</button>
                </div>
            </div>
        `;
        return card;
    }

    riderPromoteBtn.addEventListener('click', async () => {
        const email = riderSearchEmail.value.trim();
        if (!email) {
            alert('Escribe el correo del usuario a promover.');
            return;
        }
        riderPromoteBtn.disabled = true;

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('email', email)
            .maybeSingle();

        if (error || !profile) {
            riderPromoteBtn.disabled = false;
            alert('No existe un usuario registrado con ese correo.');
            return;
        }
        if (profile.role === 'domiciliario') {
            riderPromoteBtn.disabled = false;
            alert('Ese usuario ya es domiciliario.');
            return;
        }

        const { error: updateError } = await supabase
            .from('profiles')
            .update({ role: 'domiciliario' })
            .eq('id', profile.id);

        riderPromoteBtn.disabled = false;
        if (updateError) {
            console.error('Error promoviendo usuario:', updateError);
            alert('No se pudo asignar el rol. Verifica que tengas permisos de administrador.');
            return;
        }
        riderSearchEmail.value = '';
        loadRiders();
    });

    ridersContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.dataset.action !== 'demote-rider') return;
        if (!confirm('¿Quitar el rol de domiciliario a este usuario? Volverá a ser cliente.')) return;

        const { error } = await supabase
            .from('profiles')
            .update({ role: 'cliente' })
            .eq('id', btn.dataset.id);

        if (error) {
            console.error('Error quitando rol:', error);
            alert('No se pudo quitar el rol. Intenta de nuevo.');
            return;
        }
        loadRiders();
    });

    function openRiderModal() {
        riderForm.reset();
        riderFormError.textContent = '';
        riderPasswordInput.type = 'password';
        toggleRiderPasswordBtn.querySelector('i').className = 'fas fa-eye';
        riderModal.style.display = 'flex';
        riderNameInput.focus();
    }

    function closeRiderModal() {
        riderModal.style.display = 'none';
    }

    async function createRider(e) {
        e.preventDefault();
        riderFormError.textContent = '';
        saveRiderBtn.disabled = true;
        saveRiderBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';

        const name = riderNameInput.value.trim();
        const phone = riderPhoneInput.value.trim();
        const email = riderEmailInput.value.trim();
        const password = riderPasswordInput.value;

        // 1. Crear la cuenta en auth.users
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name }
            }
        });

        if (signUpError) {
            riderFormError.textContent = signUpError.message.includes('already registered')
                ? 'Ya existe una cuenta con ese correo. Usa la opción "Promover usuario existente".' 
                : `Error al crear la cuenta: ${signUpError.message}`;
            saveRiderBtn.disabled = false;
            saveRiderBtn.innerHTML = '<i class="fas fa-user-plus"></i> Crear cuenta';
            return;
        }

        const userId = signUpData.user?.id;
        if (!userId) {
            riderFormError.textContent = 'La cuenta fue creada pero el servidor no devolvió el ID. Asigna el rol manualmente desde Supabase.';
            saveRiderBtn.disabled = false;
            saveRiderBtn.innerHTML = '<i class="fas fa-user-plus"></i> Crear cuenta';
            return;
        }

        // 2. Actualizar (o insertar) el perfil con rol domiciliario
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: userId,
                role: 'domiciliario',
                full_name: name,
                phone: phone || null,
                email: email,
                is_available: false
            }, { onConflict: 'id' });

        saveRiderBtn.disabled = false;
        saveRiderBtn.innerHTML = '<i class="fas fa-user-plus"></i> Crear cuenta';

        if (profileError) {
            console.error('Error asignando perfil:', profileError);
            riderFormError.textContent = 'Cuenta creada, pero no se pudo asignar el rol automáticamente. Ve a Supabase y ponle role="domiciliario" al usuario ' + email + '.';
            return;
        }

        closeRiderModal();
        loadRiders();
        alert(`✅ Domiciliario "${name}" creado correctamente. Ya puede iniciar sesión en el panel de domiciliarios con ${email}.`);
    }

    // --- CRUD DE PRODUCTOS ---
    async function loadAdminProducts() {
        productsEmptyMessage.style.display = 'block';
        productsEmptyMessage.textContent = 'Cargando productos...';

        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error cargando productos:', error);
            productsEmptyMessage.textContent = 'No se pudieron cargar los productos.';
            return;
        }
        allProducts = data || [];
        renderAdminProducts();
    }

    function renderAdminProducts() {
        productsContainer.querySelectorAll('.product-card').forEach(el => el.remove());
        if (allProducts.length === 0) {
            productsEmptyMessage.style.display = 'block';
            productsEmptyMessage.textContent = 'No hay productos en el catálogo. Crea el primero con "+ Nuevo Producto".';
            return;
        }
        productsEmptyMessage.style.display = 'none';
        allProducts.forEach(product => productsContainer.appendChild(buildProductCard(product)));
        updateCategoryOptions();
    }

    function getProductImageUrl(imagePath) {
        if (!imagePath) return null;
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
        return `https://sjoytwcrdewealudjxep.supabase.co/storage/v1/object/public/product-images/${imagePath}`;
    }

    function buildProductCard(product) {
        const card = document.createElement('div');
        card.className = 'product-card';

        const imgUrl = getProductImageUrl(product.image_path);
        const thumbHtml = imgUrl
            ? `<img class="product-thumb" src="${imgUrl}" alt="${product.name}" onerror="this.outerHTML='<div class=&quot;product-thumb-placeholder&quot;><i class=&quot;fas fa-utensils&quot;></i></div>'">`
            : '<div class="product-thumb-placeholder"><i class="fas fa-utensils"></i></div>';

        const badges = [];
        if (product.is_offer) badges.push('<span class="product-badge product-badge-offer">Oferta</span>');
        if (product.is_new) badges.push('<span class="product-badge product-badge-new">Nuevo</span>');

        const priceHtml = product.is_offer && product.offer_price
            ? `${formatPrice(product.offer_price)}<span class="old-price">${formatPrice(product.price)}</span>`
            : formatPrice(product.price);

        card.innerHTML = `
            ${thumbHtml}
            <div class="product-card-body">
                <h4 class="product-card-name">${product.name}</h4>
                <span class="product-card-category">${product.category || 'Sin categoría'}</span>
                <div class="product-badges">${badges.join('')}</div>
                <div class="product-card-price">${priceHtml}</div>
                <span class="product-card-stock">Stock: ${product.stock}</span>
                <div class="product-actions">
                    <button class="btn btn-edit" data-action="edit-product" data-id="${product.id}"><i class="fas fa-pen"></i> Editar</button>
                    <button class="btn btn-delete" data-action="delete-product" data-id="${product.id}"><i class="fas fa-trash"></i> Eliminar</button>
                </div>
            </div>
        `;
        return card;
    }

    function openProductModal(product) {
        editingProductId = product ? product.id : null;
        pendingImageFile = null;
        productImageFileInput.value = '';
        productImagePreview.style.display = 'none';
        productImagePreview.src = '';
        productModalTitle.textContent = product ? 'Editar Producto' : 'Nuevo Producto';
        productNameInput.value = product ? product.name : '';
        productDescriptionInput.value = product ? (product.description || '') : '';
        productDetailedDescriptionInput.value = product ? (product.detailed_description || '') : '';
        productPriceInput.value = product ? product.price : '';
        productOfferPriceInput.value = product && product.offer_price ? product.offer_price : '';
        
        // Cargar y seleccionar la categoría
        updateCategoryOptions(product ? product.category : '');
        
        productStockInput.value = product ? (product.stock ?? 0) : 0;
        productImageInput.value = product ? (product.image_path && !product.image_path.startsWith('http') ? '' : (product.image_path || '')) : '';
        productIsOfferInput.checked = product ? !!product.is_offer : false;
        productIsNewInput.checked = product ? !!product.is_new : false;
        productModal.style.display = 'flex';

        // Vista previa de la imagen actual
        const imgUrl = product ? getProductImageUrl(product.image_path) : null;
        if (imgUrl) {
            productImagePreview.src = imgUrl;
            productImagePreview.style.display = 'block';
        }
    }

    function handleProductImageFile() {
        const file = productImageFileInput.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert('Selecciona un archivo de imagen válido.');
            productImageFileInput.value = '';
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            alert('La imagen no puede superar 2 MB.');
            productImageFileInput.value = '';
            return;
        }
        pendingImageFile = file;
        productImagePreview.src = URL.createObjectURL(file);
        productImagePreview.style.display = 'block';
        productImageInput.value = '';
    }

    async function uploadPendingImage() {
        if (!pendingImageFile) return null;
        const ext = (pendingImageFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const { error } = await supabase.storage.from('product-images').upload(path, pendingImageFile, { upsert: false });
        if (error) {
            console.error('Error subiendo imagen:', error);
            throw new Error('No se pudo subir la imagen.');
        }
        return path;
    }

    function closeProductModal() {
        productModal.style.display = 'none';
    }

    async function saveProduct(e) {
        e.preventDefault();
        saveProductBtn.disabled = true;

        let category = productCategoryInput.value;
        if (category === '__new__') {
            category = productNewCategoryInput.value.trim();
        }
        if (!category) {
            alert('Por favor selecciona o crea una categoría.');
            saveProductBtn.disabled = false;
            return;
        }

        let imagePath = productImageInput.value.trim() || null;
        if (pendingImageFile) {
            try {
                imagePath = await uploadPendingImage();
            } catch (uploadError) {
                alert(uploadError.message);
                saveProductBtn.disabled = false;
                return;
            }
        }

        const payload = {
            name: productNameInput.value.trim(),
            description: productDescriptionInput.value.trim() || null,
            detailed_description: productDetailedDescriptionInput.value.trim() || null,
            price: parseFloat(productPriceInput.value) || 0,
            offer_price: productOfferPriceInput.value ? parseFloat(productOfferPriceInput.value) : null,
            is_offer: productIsOfferInput.checked,
            is_new: productIsNewInput.checked,
            category: category || null,
            stock: parseInt(productStockInput.value) || 0,
            image_path: imagePath
        };

        let error;
        if (editingProductId) {
            ({ error } = await supabase.from('products').update(payload).eq('id', editingProductId));
        } else {
            ({ error } = await supabase.from('products').insert(payload));
        }

        saveProductBtn.disabled = false;
        if (error) {
            console.error('Error guardando producto:', error);
            alert('No se pudo guardar el producto. Intenta de nuevo.');
            return;
        }
        // Si se reemplazó la imagen, borrar la anterior de storage
        if (pendingImageFile && editingProductId) {
            const oldProduct = allProducts.find(p => p.id === editingProductId);
            if (oldProduct && oldProduct.image_path && !oldProduct.image_path.startsWith('http')) {
                supabase.storage.from('product-images').remove([oldProduct.image_path]);
            }
        }
        pendingImageFile = null;
        closeProductModal();
        loadAdminProducts();
    }

    async function deleteProduct(id) {
        if (!confirm('¿Eliminar este producto? Los clientes ya no podrán pedirlo.')) return;
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) {
            console.error('Error eliminando producto:', error);
            alert('No se pudo eliminar el producto. Intenta de nuevo.');
            return;
        }
        const removed = allProducts.find(p => p.id === id);
        if (removed && removed.image_path && !removed.image_path.startsWith('http')) {
            supabase.storage.from('product-images').remove([removed.image_path]);
        }
        loadAdminProducts();
    }

    function updateCategoryOptions(selectedCategory = '') {
        const categories = [...new Set(allProducts.map(p => p.category).filter(Boolean))];
        
        let optionsHtml = '<option value="" disabled>Selecciona una categoría</option>';
        categories.forEach(c => {
            optionsHtml += `<option value="${c}">${c}</option>`;
        });
        optionsHtml += '<option value="__new__">+ Crear nueva categoría...</option>';
        
        productCategoryInput.innerHTML = optionsHtml;
        
        // Establecer el valor seleccionado
        if (selectedCategory && categories.includes(selectedCategory)) {
            productCategoryInput.value = selectedCategory;
            productNewCategoryContainer.style.display = 'none';
        } else if (selectedCategory) {
            productCategoryInput.value = '__new__';
            productNewCategoryContainer.style.display = 'block';
            productNewCategoryInput.value = selectedCategory;
        } else {
            productCategoryInput.value = '';
            productNewCategoryContainer.style.display = 'none';
        }
    }

    // --- OFERTAS RELÁMPAGO ---
    async function loadOffers() {
        offersEmptyMessage.style.display = 'block';
        offersEmptyMessage.textContent = 'Cargando ofertas...';

        const { data, error } = await supabase
            .from('flash_offers')
            .select('id, discount_percentage, starts_at, ends_at, is_active, created_at, products ( name )')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Error cargando ofertas:', error);
            offersEmptyMessage.textContent = 'No se pudieron cargar las ofertas.';
            return;
        }
        allOffers = data || [];
        renderOffers();
    }

    function renderOffers() {
        offersContainer.querySelectorAll('.product-card').forEach(el => el.remove());
        if (allOffers.length === 0) {
            offersEmptyMessage.style.display = 'block';
            offersEmptyMessage.textContent = 'No hay ofertas todavía. Crea la primera con "+ Crear Nueva Oferta".';
            return;
        }
        offersEmptyMessage.style.display = 'none';
        allOffers.forEach(offer => offersContainer.appendChild(buildOfferCard(offer)));
    }

    function buildOfferCard(offer) {
        const card = document.createElement('div');
        card.className = 'product-card';

        const isActive = offer.is_active && new Date(offer.ends_at) > new Date();
        const productName = offer.products ? offer.products.name : 'Producto eliminado';
        const remainingMs = new Date(offer.ends_at) - new Date();
        const remainingLabel = remainingMs > 0
            ? `Termina en ${Math.max(1, Math.round(remainingMs / 60000))} min`
            : 'Finalizada';

        const badgeHtml = isActive
            ? '<span class="product-badge product-badge-offer">Activa</span>'
            : '<span class="product-badge product-badge-new">Finalizada</span>';

        const actionsHtml = isActive
            ? `<button class="btn btn-status-advance" data-action="offer-email" data-id="${offer.id}"><i class="fas fa-paper-plane"></i> Enviar Alerta por Email</button>
               <button class="btn btn-delete" data-action="offer-end" data-id="${offer.id}"><i class="fas fa-stop"></i> Terminar Oferta</button>`
            : '';

        card.innerHTML = `
            <div class="product-card-body">
                <h4 class="product-card-name">${productName}</h4>
                <div class="product-badges">${badgeHtml}</div>
                <div class="product-card-price">${offer.discount_percentage}% OFF</div>
                <span class="product-card-stock">Inicio: ${new Date(offer.starts_at).toLocaleString('es-CO')}</span>
                <span class="product-card-stock">${remainingLabel} · ${new Date(offer.ends_at).toLocaleString('es-CO')}</span>
                <div class="product-actions">${actionsHtml}</div>
            </div>
        `;
        return card;
    }

    async function openOfferModal() {
        if (allProducts.length === 0) await loadAdminProducts();
        offerProductSelect.innerHTML = allProducts
            .map(p => `<option value="${p.id}">${p.name} — ${formatPrice(p.price)}</option>`)
            .join('') || '<option value="" disabled>No hay productos. Crea uno primero.</option>';
        offerDiscountInput.value = 20;
        offerDurationInput.value = 60;
        offerModal.style.display = 'flex';
    }

    async function saveOffer(e) {
        e.preventDefault();
        const productId = offerProductSelect.value;
        if (!productId) return;
        saveOfferBtn.disabled = true;

        const discount = parseInt(offerDiscountInput.value) || 0;
        const durationMin = parseInt(offerDurationInput.value) || 60;
        const endsAt = new Date(Date.now() + durationMin * 60000).toISOString();

        const { error } = await supabase
            .from('flash_offers')
            .insert({ product_id: productId, discount_percentage: discount, ends_at: endsAt });

        saveOfferBtn.disabled = false;
        if (error) {
            console.error('Error creando oferta:', error);
            alert('No se pudo crear la oferta. Intenta de nuevo.');
            return;
        }
        offerModal.style.display = 'none';
        loadOffers();
    }

    async function terminateOffer(id) {
        if (!confirm('¿Terminar esta oferta relámpago antes de tiempo?')) return;
        const { error } = await supabase.from('flash_offers').update({ is_active: false }).eq('id', id);
        if (error) {
            console.error('Error terminando oferta:', error);
            alert('No se pudo terminar la oferta.');
            return;
        }
        loadOffers();
    }

    async function sendOfferEmail(id) {
        const { data, error } = await supabase.rpc('send_flash_email', { p_offer_id: id });
        if (error) {
            console.error('Error enviando correos:', error);
            alert('No se pudieron enviar los correos. Intenta de nuevo.');
            return;
        }
        if (data && data.ok === true) {
            alert(`Correo enviado a ${data.emails.length} clientes registrados.`);
        } else {
            alert(data && data.error ? `No se envió: ${data.error}` : 'No se envió el correo.');
        }
    }

    // --- UTIL ---
    function formatPrice(price) {
        return Number(price).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    }

    checkSession();
});
