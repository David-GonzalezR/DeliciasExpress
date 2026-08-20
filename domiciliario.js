document.addEventListener('DOMContentLoaded', () => {

    const config = {
        supabaseUrl: 'https://sjoytwcrdewealudjxep.supabase.co',
        supabaseKey: 'sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF'
    };

    const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

    const STATUS_LABELS = {
        recibido: 'Recibido',
        preparando: 'Preparando',
        despachado: 'Despachado',
        buscando_domiciliario: 'Buscando domiciliario',
        en_camino: 'En camino',
        entregado: 'Entregado',
        cancelado: 'Cancelado'
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
    const availabilityToggle = document.getElementById('availability-toggle');
    const availableTab = document.getElementById('available-tab');
    const myDeliveriesTab = document.getElementById('my-deliveries-tab');
    const myProfileTab = document.getElementById('my-profile-tab');
    const availableOrdersContainer = document.getElementById('available-orders-container');
    const availableOrdersEmptyMessage = document.getElementById('available-orders-empty-message');
    const myDeliveriesContainer = document.getElementById('my-deliveries-container');
    const myDeliveriesEmptyMessage = document.getElementById('my-deliveries-empty-message');
    const myProfileContainer = document.getElementById('my-profile-container');
    const riderProfilePhoto = document.getElementById('rider-profile-photo');
    const riderProfileName = document.getElementById('rider-profile-name');
    const changePhotoBtn = document.getElementById('change-photo-btn');
    const riderPhotoFile = document.getElementById('rider-photo-file');
    const riderRatingEl = document.getElementById('rider-rating');
    const riderDeliveriesEl = document.getElementById('rider-deliveries');

    let currentUserId = null;
    let availableOrders = [];
    let myDeliveries = [];
    let currentTab = 'disponibles';
    let ordersChannel = null;

    // --- AUTH ---
    async function checkSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            currentUserId = session.user.id;
            await verifyRiderAccess();
        } else {
            showLogin();
        }
    }

    async function verifyRiderAccess() {
        try {
            const { data: role, error } = await supabase.rpc('get_user_role');
            if (error) throw error;

            if (role === 'domiciliario') {
                showDashboard();
            } else {
                await supabase.auth.signOut();
                currentUserId = null;
                showLogin();
                loginError.textContent = 'Acceso denegado. Se requieren permisos de domiciliario.';
            }
        } catch (error) {
            console.error('Error verificando rol:', error);
            await supabase.auth.signOut();
            currentUserId = null;
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
        loadAvailability();
        loadAvailableOrders();
        loadMyDeliveries();
        subscribeToOrders();
        setInterval(() => {
            if (currentTab === 'disponibles') loadAvailableOrders();
        }, 20000);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = 'Entrando...';

        const { data, error } = await supabase.auth.signInWithPassword({
            email: loginEmail.value.trim(),
            password: loginPassword.value
        });

        if (error || !data.session) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = 'Entrar';
            loginError.textContent = 'Correo o contraseña incorrectos.';
            return;
        }

        currentUserId = data.session.user.id;
        await verifyRiderAccess();

        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Entrar';
    });

    logoutBtn.addEventListener('click', async () => {
        if (ordersChannel) supabase.removeChannel(ordersChannel);
        await supabase.auth.signOut();
        currentUserId = null;
        showLogin();
    });

    // --- DISPONIBILIDAD ---
    async function loadAvailability() {
        const { data: rider, error } = await supabase
            .from('riders')
            .select('is_available')
            .eq('id', currentUserId)
            .maybeSingle();
        if (!error && rider) {
            availabilityToggle.checked = !!rider.is_available;
        }
    }

    availabilityToggle.addEventListener('change', async (e) => {
        if (!currentUserId) return;
        const { error } = await supabase
            .from('riders')
            .update({ is_available: e.target.checked })
            .eq('id', currentUserId);
        if (error) {
            console.error('Error actualizando disponibilidad:', error);
            alert('No se pudo actualizar tu disponibilidad.');
            e.target.checked = !e.target.checked;
        }
    });

    // --- CARGA DE PEDIDOS ---
    async function loadAvailableOrders() {
        availableOrdersEmptyMessage.style.display = 'block';
        availableOrdersEmptyMessage.textContent = 'Cargando pedidos disponibles...';

        const { data, error } = await supabase
            .from('orders')
            .select(`
                id, delivery_address, status, total, created_at,
                delivery_lat, delivery_lng, customer_phone,
                order_items ( id, product_name, quantity, unit_price, customizations, instructions )
            `)
            .eq('status', 'buscando_domiciliario')
            .is('assigned_rider_id', null)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error cargando pedidos disponibles:', error);
            availableOrdersEmptyMessage.textContent = 'No se pudieron cargar los pedidos disponibles.';
            return;
        }

        availableOrders = data || [];
        renderAvailableOrders();
    }

    async function loadMyDeliveries() {
        myDeliveriesEmptyMessage.style.display = 'block';
        myDeliveriesEmptyMessage.textContent = 'Cargando mis entregas...';

        const { data, error } = await supabase
            .from('orders')
            .select(`
                id, delivery_address, status, total, created_at,
                assigned_rider_id, delivery_accepted_at, delivered_at,
                delivery_lat, delivery_lng, customer_phone,
                order_items ( id, product_name, quantity, unit_price, customizations, instructions )
            `)
            .eq('assigned_rider_id', currentUserId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error cargando mis entregas:', error);
            myDeliveriesEmptyMessage.textContent = 'No se pudieron cargar tus entregas.';
            return;
        }

        myDeliveries = (data || []).filter(o => o.status === 'en_camino');
        renderMyDeliveries();
    }

    // --- REALTIME ---
    function subscribeToOrders() {
        if (ordersChannel) supabase.removeChannel(ordersChannel);

        ordersChannel = supabase
            .channel('domiciliarios-orders-changes')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
                handleOrderRealtimeUpdate(payload.new);
            })
            .subscribe();
    }

    async function fetchOrderWithItems(orderId) {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                id, delivery_address, status, total, created_at,
                assigned_rider_id, delivery_accepted_at, delivered_at,
                delivery_lat, delivery_lng, customer_phone,
                order_items ( id, product_name, quantity, unit_price, customizations, instructions )
            `)
            .eq('id', orderId)
            .single();
        if (error || !data) return null;
        return data;
    }

    function handleOrderRealtimeUpdate(order) {
        if (!currentUserId) return;

        if (order.status === 'buscando_domiciliario' && !order.assigned_rider_id) {
            fetchOrderWithItems(order.id).then(fullOrder => {
                if (fullOrder) insertOrderIntoAvailable(fullOrder);
            });
            return;
        }

        if (order.status === 'en_camino' && order.assigned_rider_id === currentUserId) {
            const fromAvailable = availableOrders.find(o => o.id === order.id);
            if (fromAvailable) {
                removeOrderFromAvailable(order.id);
                insertOrderIntoMyDeliveries({ ...fromAvailable, status: 'en_camino' });
            } else {
                fetchOrderWithItems(order.id).then(fullOrder => {
                    if (fullOrder) insertOrderIntoMyDeliveries(fullOrder);
                });
            }
            return;
        }

        if (order.status === 'en_camino' && order.assigned_rider_id !== currentUserId) {
            removeOrderFromAvailable(order.id);
            return;
        }

        if (order.status === 'entregado' || order.status === 'cancelado') {
            removeOrderFromAvailable(order.id);
            if (order.assigned_rider_id === currentUserId) {
                removeOrderFromMyDeliveries(order.id);
            }
            return;
        }
    }

    function insertOrderIntoAvailable(order) {
        if (availableOrders.some(o => o.id === order.id)) return;
        const item = { ...order, order_items: order.order_items || [] };
        availableOrders.unshift(item);
        renderAvailableOrders();
        playNewOrderChime();
    }

    function insertOrderIntoMyDeliveries(order) {
        if (myDeliveries.some(o => o.id === order.id)) return;
        myDeliveries.unshift({ ...order, order_items: order.order_items || [] });
        renderMyDeliveries();
    }

    function removeOrderFromAvailable(orderId) {
        const before = availableOrders.length;
        availableOrders = availableOrders.filter(o => o.id !== orderId);
        if (availableOrders.length !== before) renderAvailableOrders();
    }

    function removeOrderFromMyDeliveries(orderId) {
        const before = myDeliveries.length;
        myDeliveries = myDeliveries.filter(o => o.id !== orderId);
        if (myDeliveries.length !== before) renderMyDeliveries();
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

    // --- PESTAÑAS ---
    function setTab(tab) {
        currentTab = tab;
        availableTab.classList.toggle('active', tab === 'disponibles');
        myDeliveriesTab.classList.toggle('active', tab === 'mis-entregas');
        myProfileTab.classList.toggle('active', tab === 'mi-perfil');
        availableOrdersContainer.style.display = tab === 'disponibles' ? 'block' : 'none';
        myDeliveriesContainer.style.display = tab === 'mis-entregas' ? 'block' : 'none';
        myProfileContainer.style.display = tab === 'mi-perfil' ? 'block' : 'none';
        if (tab === 'disponibles') renderAvailableOrders();
        if (tab === 'mis-entregas') renderMyDeliveries();
        if (tab === 'mi-perfil') loadMyProfile();
    }

    availableTab.addEventListener('click', () => setTab('disponibles'));
    myDeliveriesTab.addEventListener('click', () => setTab('mis-entregas'));
    myProfileTab.addEventListener('click', () => setTab('mi-perfil'));

    // --- MI PERFIL ---
    async function loadMyProfile() {
        const { data, error } = await supabase
            .from('profiles')
            .select('full_name, riders ( photo_url, rating, total_deliveries, vehicle_type, vehicle_plate )')
            .eq('id', currentUserId)
            .maybeSingle();

        if (!error && data) {
            const rData = data.riders || {};
            if (riderProfileName) riderProfileName.textContent = data.full_name || 'Domiciliario';
            if (riderRatingEl) riderRatingEl.textContent = (rData.rating || 5).toFixed(1);
            if (riderDeliveriesEl) riderDeliveriesEl.textContent = rData.total_deliveries || 0;
            if (riderProfilePhoto) {
                const nameFallback = encodeURIComponent(data.full_name || 'Rider');
                const photoUrl = rData.photo_url;
                riderProfilePhoto.src = photoUrl ? `${photoUrl}?t=${new Date().getTime()}` : `https://ui-avatars.com/api/?name=${nameFallback}&background=d32f2f&color=fff&size=128`;
            }
        }
    }

    async function uploadRiderPhoto(file) {
        changePhotoBtn.disabled = true;
        changePhotoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';

        try {
            // Optimización y recorte automático a un cuadrado de 400x400
            const processedFile = await processAndCropImage(file, 400);
            
            const ext = 'jpg';
            const path = `${currentUserId}.${ext}`;
            const { error: uploadError } = await supabase.storage
                .from('rider-photos')
                .upload(path, processedFile, { upsert: true, contentType: 'image/jpeg' });

            if (uploadError) {
                console.error('Error subiendo foto:', uploadError);
                alert('No se pudo subir la foto. Intenta de nuevo.');
                return;
            }

            const { data: urlData } = supabase.storage.from('rider-photos').getPublicUrl(path);
            const photoUrl = urlData.publicUrl;

            const { error: dbError } = await supabase
                .from('riders')
                .update({ photo_url: photoUrl })
                .eq('id', currentUserId);

            if (dbError) {
                console.error('Error guardando photo_url:', dbError);
                alert('La foto se subió pero no se pudo guardar la referencia: ' + (dbError.message || JSON.stringify(dbError)));
                return;
            }

            if (riderProfilePhoto) riderProfilePhoto.src = `${photoUrl}?t=${new Date().getTime()}`;
        } finally {
            changePhotoBtn.disabled = false;
            changePhotoBtn.innerHTML = '<i class="fas fa-camera"></i> Cambiar foto';
        }
    }

    function processAndCropImage(file, size) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    
                    // Calcular el recorte centrado
                    const minSize = Math.min(img.width, img.height);
                    const startX = (img.width - minSize) / 2;
                    const startY = (img.height - minSize) / 2;
                    
                    // Dibujar imagen recortada (fondo blanco en caso de PNG transparente)
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, size, size);
                    ctx.drawImage(img, startX, startY, minSize, minSize, 0, 0, size, size);
                    
                    canvas.toBlob((blob) => {
                        resolve(blob);
                    }, 'image/jpeg', 0.85); // 85% de calidad JPG
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    changePhotoBtn.addEventListener('click', () => riderPhotoFile.click());
    riderPhotoFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadRiderPhoto(file);
    });

    // --- RENDER ---
    function renderAvailableOrders() {
        availableOrdersContainer.querySelectorAll('.order-card').forEach(el => el.remove());

        if (availableOrders.length === 0) {
            availableOrdersEmptyMessage.style.display = 'block';
            availableOrdersEmptyMessage.textContent = 'No hay pedidos disponibles. Cuando el admin pida un domicilio, aparecerá aquí.';
            return;
        }
        availableOrdersEmptyMessage.style.display = 'none';
        availableOrders.forEach(order => {
            availableOrdersContainer.appendChild(buildAvailableOrderCard(order));
        });
    }

    function renderMyDeliveries() {
        myDeliveriesContainer.querySelectorAll('.order-card').forEach(el => el.remove());

        if (myDeliveries.length === 0) {
            myDeliveriesEmptyMessage.style.display = 'block';
            myDeliveriesEmptyMessage.textContent = 'No tienes entregas asignadas.';
            return;
        }
        myDeliveriesEmptyMessage.style.display = 'none';
        myDeliveries.forEach(order => {
            myDeliveriesContainer.appendChild(buildMyDeliveryCard(order));
        });
    }

    function buildOrderItemsHtml(order) {
        return (order.order_items || []).map(item => {
            let extras = '';
            if (item.customizations && item.customizations.length > 0) {
                extras += `<div class="item-extras">Extras: ${item.customizations.map(c => c.name).join(', ')}</div>`;
            }
            if (item.instructions) {
                extras += `<div class="item-extras"><i>${item.instructions}</i></div>`;
            }
            return `<li><strong>${item.quantity}x</strong> ${item.product_name}${extras}</li>`;
        }).join('');
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

    function buildOrderCardBase(order, badgeStatus) {
        const card = document.createElement('div');
        card.className = `order-card status-${order.status}`;

        const shortId = order.id.slice(0, 8).toUpperCase();
        const time = new Date(order.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        const mapsLink = buildMapsLink(order);
        const phoneInfo = order.customer_phone
            ? `<div class="order-card-rider"><i class="fas fa-phone"></i> ${order.customer_phone}</div>`
            : '';

        card.innerHTML = `
            <div class="order-card-header">
                <div>
                    <div class="order-card-id">#${shortId}</div>
                    <div class="order-card-time">${time}</div>
                </div>
                <span class="order-status-badge">${STATUS_LABELS[order.status] || order.status}</span>
            </div>
            <div class="order-card-address"><i class="fas fa-location-dot"></i> ${order.delivery_address}</div>
            ${phoneInfo}
            <ul class="order-card-items">${buildOrderItemsHtml(order)}</ul>
            <div class="order-card-total"><span>Total</span><span>${formatPrice(order.total)}</span></div>
            ${mapsLink ? `<div class="order-card-actions"><a class="btn btn-secondary" href="${mapsLink}" target="_blank" rel="noopener"><i class="fas fa-map-location-dot"></i> Ver en Google Maps</a></div>` : ''}
            <div class="order-card-actions">${badgeStatus}</div>
        `;
        return card;
    }

    function buildAvailableOrderCard(order) {
        const actions = `<button class="btn btn-status-advance" data-action="accept" data-id="${order.id}">
            <i class="fas fa-hand-holding-heart"></i> Aceptar pedido
        </button>`;
        return buildOrderCardBase(order, actions);
    }

    function buildMyDeliveryCard(order) {
        const actions = `<button class="btn btn-status-advance" data-action="deliver" data-id="${order.id}">
            <i class="fas fa-check-double"></i> Marcar como entregado
        </button>`;
        return buildOrderCardBase(order, actions);
    }

    // --- ACCIONES ---
    availableOrdersContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.dataset.action !== 'accept') return;

        const orderId = btn.dataset.id;
        btn.disabled = true;

        const { data, error } = await supabase.rpc('accept_delivery', { p_order_id: orderId });
        if (error || !(data && data.ok)) {
            if (data && data.error === 'ya_tomado') {
                alert('Este pedido ya fue tomado por otro domiciliario.');
            } else if (data && data.error) {
                alert('No se pudo aceptar el pedido: ' + data.error);
            } else if (error) {
                alert('Error de base de datos: ' + error.message);
            } else {
                alert('No se pudo aceptar el pedido. Intenta de nuevo.');
            }
            removeOrderFromAvailable(orderId);
            return;
        }

        const order = availableOrders.find(o => o.id === orderId);
        if (order) {
            removeOrderFromAvailable(orderId);
            insertOrderIntoMyDeliveries({ ...order, status: 'en_camino', assigned_rider_id: currentUserId });
            setTab('mis-entregas');
            loadAvailability();
        }
    });

    myDeliveriesContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.dataset.action !== 'deliver') return;

        const orderId = btn.dataset.id;
        btn.disabled = true;

        const { data, error } = await supabase.rpc('mark_delivered', { p_order_id: orderId });
        if (error || !(data && data.ok)) {
            alert('No se pudo marcar como entregado. Intenta de nuevo.');
            btn.disabled = false;
            return;
        }

        removeOrderFromMyDeliveries(orderId);
        loadAvailability();
    });

    // --- UTIL ---
    function formatPrice(price) {
        return Number(price).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    }

    checkSession();
});
