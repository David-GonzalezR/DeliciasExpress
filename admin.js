document.addEventListener('DOMContentLoaded', () => {

    const config = {
        supabaseUrl: 'https://sjoytwcrdewealudjxep.supabase.co',
        supabaseKey: 'sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF'
    };

    const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

    // --- STATUS FLOW ---
    const STATUS_FLOW = ['recibido', 'preparando', 'despachado', 'entregado'];
    const STATUS_LABELS = {
        recibido: 'Recibido',
        preparando: 'Preparando',
        despachado: 'Despachado',
        entregado: 'Entregado',
        cancelado: 'Cancelado'
    };
    const NEXT_ACTION_LABEL = {
        recibido: 'Marcar Preparando',
        preparando: 'Marcar Despachado',
        despachado: 'Marcar Entregado'
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

    let allOrders = [];
    let currentFilter = 'activos';
    let ordersChannel = null;
    let allProducts = [];
    let editingProductId = null;
    let allOffers = [];

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
    async function loadOrders() {
        ordersEmptyMessage.style.display = 'block';
        ordersEmptyMessage.textContent = 'Cargando pedidos...';

        const { data, error } = await supabase
            .from('orders')
            .select(`
                id, delivery_address, status, total, created_at,
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
        if (currentFilter === 'activos') return allOrders.filter(o => ['recibido', 'preparando', 'despachado'].includes(o.status));
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
        if (STATUS_FLOW.includes(order.status) && order.status !== 'entregado') {
            actionsHtml += `<button class="btn btn-status-advance" data-action="advance" data-id="${order.id}" data-current="${order.status}">${NEXT_ACTION_LABEL[order.status]}</button>`;
        }
        if (order.status !== 'entregado' && order.status !== 'cancelado') {
            actionsHtml += `<button class="btn btn-status-cancel" data-action="cancel" data-id="${order.id}">Cancelar</button>`;
        }

        card.innerHTML = `
            <div class="order-card-header">
                <div>
                    <div class="order-card-id">#${shortId}</div>
                    <div class="order-card-time">${time}</div>
                </div>
                <span class="order-status-badge">${STATUS_LABELS[order.status] || order.status}</span>
            </div>
            <div class="order-card-address"><i class="fas fa-location-dot"></i> ${order.delivery_address}</div>
            <ul class="order-card-items">${itemsHtml}</ul>
            <div class="order-card-total"><span>Total</span><span>${formatPrice(order.total)}</span></div>
            <div class="order-card-actions">${actionsHtml}</div>
        `;
        return card;
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
        });
    });
    newProductBtn.addEventListener('click', () => openProductModal(null));
    closeProductModalBtn.addEventListener('click', closeProductModal);
    cancelProductBtn.addEventListener('click', closeProductModal);
    productForm.addEventListener('submit', saveProduct);
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

    // --- NAVEGACIÓN ENTRE VISTAS ---
    function showView(view) {
        sidebarButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
        pedidosView.style.display = view === 'pedidos' ? 'block' : 'none';
        productosView.style.display = view === 'productos' ? 'block' : 'none';
        ofertasView.style.display = view === 'ofertas' ? 'block' : 'none';
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
        productModalTitle.textContent = product ? 'Editar Producto' : 'Nuevo Producto';
        productNameInput.value = product ? product.name : '';
        productDescriptionInput.value = product ? (product.description || '') : '';
        productDetailedDescriptionInput.value = product ? (product.detailed_description || '') : '';
        productPriceInput.value = product ? product.price : '';
        productOfferPriceInput.value = product && product.offer_price ? product.offer_price : '';
        
        // Cargar y seleccionar la categoría
        updateCategoryOptions(product ? product.category : '');
        
        productStockInput.value = product ? (product.stock ?? 0) : 0;
        productImageInput.value = product ? (product.image_path || '') : '';
        productIsOfferInput.checked = product ? !!product.is_offer : false;
        productIsNewInput.checked = product ? !!product.is_new : false;
        productModal.style.display = 'flex';
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
            image_path: productImageInput.value.trim() || null
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
