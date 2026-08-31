document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURACIÓN DE LA TIENDA ---
    const config = {
        whatsappNumber: '573156349313',
        supabaseUrl: 'https://sjoytwcrdewealudjxep.supabase.co',
        supabaseKey: 'sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF',
        productImagesBucket: 'product-images'
    };

    const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

    // --- SELECCIÓN DE ELEMENTOS DEL DOM ---
    const heroSection = document.getElementById('hero-section');
    const viewMenuHeroBtn = document.getElementById('view-menu-hero-btn');
    const menuSection = document.getElementById('menu-section');
    const categoryButtonsContainer = document.getElementById('category-buttons-container');
    const productListContainer = document.getElementById('product-list-container');
    const currentCategoryTitleElement = document.getElementById('current-category-title');
    const cartIconButton = document.getElementById('cart-icon-button');
    const cartCountElement = document.getElementById('cart-count');
    const searchInput = document.getElementById('search-input');
    const gridViewBtn = document.getElementById('grid-view-btn');
    const listViewBtn = document.getElementById('list-view-btn');

    // Modal de Producto
    const productModal = document.getElementById('product-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalImg = document.getElementById('modal-img');
    const modalName = document.getElementById('modal-name');
    const modalDetailedDescription = document.getElementById('modal-detailed-description');
    const modalPriceElement = document.getElementById('modal-price');
    const modalCustomizationSection = document.getElementById('modal-customization-section');
    const modalSpecialInstructions = document.getElementById('modal-special-instructions');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');

    // Modal de Carrito
    const cartModal = document.getElementById('cart-modal');
    const closeCartModalBtn = document.getElementById('close-cart-modal-btn');
    const cartItemsContainer = document.getElementById('cart-items-container');
    const emptyCartMessage = document.getElementById('empty-cart-message');
    const cartTotalPriceElement = document.getElementById('cart-total-price');
    const continueShoppingBtn = document.getElementById('continue-shopping-btn');
    const checkoutBtn = document.getElementById('checkout-btn');
    const clearCartBtn = document.getElementById('clear-cart-btn');
    const deliveryAddressInput = document.getElementById('delivery-address');
    const useGpsBtn = document.getElementById('use-gps-btn');
    const gpsStatus = document.getElementById('gps-status');
    const customerPhoneInput = document.getElementById('customer-phone');

    // Alerta Personalizada
    const customAlert = document.getElementById('custom-alert');
    const customAlertMessage = document.getElementById('custom-alert-message');
    const customAlertCloseBtn = document.getElementById('custom-alert-close-btn');

    // Banner de Oferta Relámpago
    const flashBanner = document.getElementById('flash-banner');
    const flashBannerText = document.getElementById('flash-banner-text');
    const flashBannerTimer = document.getElementById('flash-banner-timer');
    const flashBannerClose = document.getElementById('flash-banner-close');

    // Compartir
    const shareAppBtn = document.getElementById('share-app-btn');

    // Autenticación (DOM)
    const authModal = document.getElementById('auth-modal');
    const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
    const userMenuButton = document.getElementById('user-menu-button');
    const myOrdersBtn = document.getElementById('my-orders-btn');
    const userDropdown = document.getElementById('user-dropdown');
    const userDropdownName = document.getElementById('user-dropdown-name');
    const logoutClientBtn = document.getElementById('logout-client-btn');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const authEmailForm = document.getElementById('auth-email-form');
    const authNameGroup = document.getElementById('auth-name-group');
    const authNameInput = document.getElementById('auth-name');
    const authEmailInput = document.getElementById('auth-email');
    const authPasswordInput = document.getElementById('auth-password');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authError = document.getElementById('auth-error');
    const authToggleBtn = document.getElementById('auth-toggle-btn');
    const authToggleMessage = document.getElementById('auth-toggle-message');

    // Seguimiento de pedido
    const trackOrderButton = document.getElementById('track-order-button');
    const orderStatusModal = document.getElementById('order-status-modal');
    const closeOrderStatusModalBtn = document.getElementById('close-order-status-modal-btn');
    const orderStatusShortId = document.getElementById('order-status-short-id');
    const orderStatusTotal = document.getElementById('order-status-total');
    const orderStatusTimeline = document.getElementById('order-status-timeline');
    const orderStatusCancelledMsg = document.getElementById('order-status-cancelled-msg');
    const orderRiderInfo = document.getElementById('order-rider-info');
    const orderStatusList = document.getElementById('order-status-list');
    const confirmReceiptBtn = document.getElementById('confirm-receipt-btn');
    const forgetOrderBtn = document.getElementById('forget-order-btn');

    // --- ESTADO DE LA APLICACIÓN ---
    let allProducts = [];
    let cart = [];
    let currentModalProduct = null;
    let currentCategory = 'Todas';
    let currentSearchTerm = '';
    let currentViewMode = 'grid';
    let heroCarouselInterval;
    let currentHeroSlide = 0;
    let trackedOrderIds = [];
    let trackedOrderId = null;
    let selectedOrderId = null;
    let orderRealtimeChannel = null;
    let orderPollingInterval = null;
    let currentUser = null;
    let isSignupMode = false;
    let flashDiscountMap = {};
    let flashTimerInterval = null;
    let capturedLat = null;
    let capturedLng = null;
    let gpsCapturePromise = null;
    let gpsCaptureResolve = null;
    let gpsCaptureReject = null;

    // Pasos visibles del tracker para el cliente:
    // Recibido → Preparando → En camino → Entregado
    // 'despachado' es estado interno del admin; el cliente nunca lo ve.
    const ORDER_STATUS_STEPS = ['recibido', 'preparando', 'en_camino', 'entregado'];
    // Mapea estados internos al paso que activan en el tracker del cliente
    const TRACK_STATUS_MAP = {
        despachado: 'preparando',          // si algún pedido legacy está en despachado, se muestra como preparando
        buscando_domiciliario: 'en_camino' // ya se está buscando → activa el paso "en camino"
    };
    const ORDER_STATUS_LABELS = {
        recibido: 'Recibido',
        preparando: 'Preparando',
        despachado: 'Preparando',    // legacy: tratar como preparando al cliente
        buscando_domiciliario: 'Buscando domiciliario',
        en_camino: 'En camino',
        entregado: 'Entregado',
        cancelado: 'Cancelado'
    };
    const orderStatuses = {};
    const orderTotals = {};

    // --- INICIALIZACIÓN ---
    function initialize() {
        document.getElementById('current-year').textContent = new Date().getFullYear();
        loadFromLocalStorage();
        checkAuthState();
        addEventListeners();
        loadDataAndRender();
        updateCartCount();
        initOrderTracking();
    }

    // --- MANEJO DE DATOS Y LOCALSTORAGE ---
    function saveCartToLocalStorage() {
        localStorage.setItem('shoppingCart', JSON.stringify(cart));
    }

    function saveAddressToLocalStorage() {
        localStorage.setItem('deliveryAddress', deliveryAddressInput.value);
    }

    function saveViewModeToLocalStorage() {
        localStorage.setItem('viewMode', currentViewMode);
    }

    function loadFromLocalStorage() {
        const savedCart = localStorage.getItem('shoppingCart');
        if (savedCart) {
            cart = JSON.parse(savedCart);
        }
        const savedAddress = localStorage.getItem('deliveryAddress');
        if (savedAddress) {
            deliveryAddressInput.value = savedAddress;
        }
        const savedViewMode = localStorage.getItem('viewMode');
        if (savedViewMode) {
            currentViewMode = savedViewMode;
        }
        const savedTrackedOrders = localStorage.getItem('trackedOrders');
        if (savedTrackedOrders) {
            try {
                trackedOrderIds = JSON.parse(savedTrackedOrders);
                if (!Array.isArray(trackedOrderIds)) trackedOrderIds = [];
            } catch (e) {
                trackedOrderIds = [];
            }
        }
        const lastOrderId = localStorage.getItem('lastOrderId');
        if (lastOrderId && !trackedOrderIds.includes(lastOrderId)) {
            trackedOrderIds.unshift(lastOrderId);
        }
        trackedOrderIds = trackedOrderIds.slice(0, 10);
        trackedOrderId = trackedOrderIds[0] || null;
    }

    // --- CARGA DE PRODUCTOS DESDE SUPABASE ---
    async function loadDataAndRender() {
        renderProductsLoadingState();
        try {
            await loadActiveFlashOffers();
            const { data, error } = await supabase
                .from('products')
                .select(`
                    id, name, description, detailed_description, price, offer_price,
                    is_offer, is_new, category, stock, image_path,
                    customization_groups (
                        id, group_title, type, default_option_id, sort_order,
                        customization_options!customization_options_group_id_fkey ( id, name, price, sort_order )
                    )
                `)
                .order('created_at', { ascending: true });

            if (error) throw error;

            allProducts = processProducts(data || []);
            renderInitialUI();

        } catch (error) {
            console.error('Error al cargar productos desde Supabase:', error);
            renderProductsErrorState();
        }
    }

    async function loadActiveFlashOffers() {
        flashDiscountMap = {};
        const { data, error } = await supabase
            .from('flash_offers')
            .select('id, product_id, discount_percentage, ends_at, products ( name )')
            .eq('is_active', true)
            .gt('ends_at', new Date().toISOString())
            .order('ends_at', { ascending: true });

        if (error) {
            console.error('Error cargando ofertas relámpago:', error);
            return;
        }

        const offers = data || [];
        offers.forEach(offer => {
            flashDiscountMap[offer.product_id] = offer.discount_percentage;
        });

        if (offers.length > 0) {
            showFlashBanner(offers[0]);
        } else {
            hideFlashBanner();
        }
    }

    function showFlashBanner(offer) {
        const productName = offer.products ? offer.products.name : 'un producto';
        flashBannerText.textContent = `🔥 ¡OFERTA RELÁMPAGO! ${offer.discount_percentage}% OFF en ${productName}. Termina en:`;
        flashBanner.style.display = 'block';
        if (flashTimerInterval) clearInterval(flashTimerInterval);
        const endTime = new Date(offer.ends_at).getTime();
        const tick = () => {
            const remaining = endTime - Date.now();
            if (remaining <= 0) {
                clearInterval(flashTimerInterval);
                flashTimerInterval = null;
                flashDiscountMap = {};
                hideFlashBanner();
                renderFilteredProducts();
                return;
            }
            const totalSec = Math.floor(remaining / 1000);
            const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
            const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
            const s = String(totalSec % 60).padStart(2, '0');
            flashBannerTimer.textContent = `${h}:${m}:${s}`;
        };
        tick();
        flashTimerInterval = setInterval(tick, 1000);
    }

    function hideFlashBanner() {
        flashBanner.style.display = 'none';
        if (flashTimerInterval) {
            clearInterval(flashTimerInterval);
            flashTimerInterval = null;
        }
    }

    function getProductImageUrl(imagePath) {
        if (!imagePath) {
            return 'https://placehold.co/600x400/CCCCCC/FFFFFF?text=Producto';
        }
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            return imagePath;
        }
        const { data } = supabase.storage.from(config.productImagesBucket).getPublicUrl(imagePath);
        return data.publicUrl;
    }

    // --- PROCESAMIENTO DE DATOS ---
    function processProducts(rows) {
        return rows.map(prod => {
            const groups = (prod.customization_groups || [])
                .slice()
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map(group => ({
                    groupTitle: group.group_title,
                    type: group.type,
                    defaultOption: group.default_option_id,
                    options: (group.customization_options || [])
                        .slice()
                        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                        .map(opt => ({
                            id: opt.id,
                            name: opt.name,
                            price: parseFloat(opt.price) || 0
                        }))
                }));

            const basePrice = parseFloat(prod.price) || 0;
            let isOffer = !!prod.is_offer;
            let offerPrice = prod.offer_price ? parseFloat(prod.offer_price) : null;
            const flashDiscount = flashDiscountMap[prod.id];
            if (flashDiscount) {
                isOffer = true;
                offerPrice = Math.round(basePrice * (1 - flashDiscount / 100));
            }

            return {
                id: prod.id,
                name: prod.name,
                description: prod.description,
                detailedDescription: prod.detailed_description,
                price: basePrice,
                imageUrl: getProductImageUrl(prod.image_path),
                category: prod.category,
                stock: parseInt(prod.stock) || 0,
                isOffer: isOffer,
                offerPrice: offerPrice,
                isNew: !!prod.is_new,
                customizationOptions: groups
            };
        });
    }

    // --- FUNCIONES DE RENDERIZADO (UI) ---

    function renderInitialUI() {
        renderHeroCarousel();
        startHeroCarousel();
        renderCategories();
        setActiveCategoryButton('Todas');
        applyViewMode(currentViewMode);
        renderFilteredProducts();
    }

    function renderFilteredProducts() {
        let filteredProducts = allProducts;

        if (currentCategory !== 'Todas') {
            filteredProducts = filteredProducts.filter(p => p.category === currentCategory);
        }

        if (currentSearchTerm) {
            filteredProducts = filteredProducts.filter(p => p.name.toLowerCase().includes(currentSearchTerm.toLowerCase()));
        }

        renderProducts(filteredProducts);
    }

    function renderProducts(productsToDisplay) {
        productListContainer.innerHTML = '';

        if (productsToDisplay.length === 0) {
            let message = `No hay productos disponibles en "${currentCategory}".`;
            if (currentSearchTerm) {
                message = `No se encontraron productos para "${currentSearchTerm}" en la categoría "${currentCategory}".`;
            }
            productListContainer.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; color: var(--color-texto-secundario); padding: 40px 0; font-size: 1.125rem;">${message}</p>`;
            return;
        }

        productsToDisplay.forEach(product => {
            const item = document.createElement('div');
            item.className = 'product-item transition-all-smooth transform-hover-translate-y-1';

            let badgeHtml = '';
            if (product.isOffer) badgeHtml += `<span class="badge badge-offer">Oferta</span>`;
            if (product.isNew) badgeHtml += `<span class="badge badge-new">Nuevo</span>`;

            const outOfStock = product.stock <= 0;
            const buttonHtml = outOfStock
                ? `<button class="btn btn-secondary" disabled>Agotado</button>`
                : `<button class="btn btn-primary add-to-cart-btn transform-hover-scale-105 transition-all-smooth" data-product-id="${product.id}">
                        <i class="fas fa-cart-plus"></i>Personalizar y Añadir
                   </button>`;

            item.innerHTML = `
                <div class="product-item-image">
                    <img src="${product.imageUrl}" alt="${product.name}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x400/CCCCCC/FFFFFF?text=Imagen+no+disponible';">
                    ${badgeHtml}
                    ${outOfStock ? '<span class="badge" style="background:#777;">Agotado</span>' : ''}
                </div>
                <div class="product-item-content">
                    <h3>${product.name}</h3>
                    <p class="description">${product.description || ''}</p>
                    <div class="product-item-price-container">
                        ${product.isOffer && product.offerPrice ?
                            `<span class="product-item-price">${formatPrice(product.offerPrice)}</span> <span class="product-item-original-price">${formatPrice(product.price)}</span>` :
                            `<span class="product-item-price">${formatPrice(product.price)}</span>`
                        }
                    </div>
                    ${buttonHtml}
                </div>
            `;
            productListContainer.appendChild(item);
        });
    }

    function applyViewMode(mode) {
        if (mode === 'list') {
            productListContainer.classList.add('list-view');
            productListContainer.classList.remove('grid-view');
            listViewBtn.classList.add('active');
            gridViewBtn.classList.remove('active');
        } else {
            productListContainer.classList.add('grid-view');
            productListContainer.classList.remove('list-view');
            gridViewBtn.classList.add('active');
            listViewBtn.classList.remove('active');
        }
        currentViewMode = mode;
        saveViewModeToLocalStorage();
    }

    function renderHeroCarousel() {
        const heroSlidesData = allProducts.filter(p => p.isNew || p.isOffer).slice(0, 5);
        if (heroSlidesData.length === 0) {
            heroSlidesData.push({ name: "DeliciasExpress", description: "Tu comida favorita, a un clic.", imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=1920" });
        }

        heroSection.innerHTML = '';
        heroSlidesData.forEach((slideData, index) => {
            const slideDiv = document.createElement('div');
            slideDiv.className = 'hero-slide';
            slideDiv.style.backgroundImage = `url('${slideData.imageUrl}')`;
            if (index === 0) slideDiv.classList.add('active');

            slideDiv.innerHTML = `
                <div class="hero-content">
                    <h2>${slideData.name}</h2>
                    <p>${slideData.description || 'Descubre nuestras delicias'}</p>
                </div>
            `;
            heroSection.appendChild(slideDiv);
        });
        heroSection.appendChild(viewMenuHeroBtn);
    }

    function renderCategories() {
        const categories = ['Todas', ...new Set(allProducts.map(p => p.category).filter(Boolean))];
        const loadingMessage = document.getElementById('category-loading-message');
        if (loadingMessage) loadingMessage.remove();

        categoryButtonsContainer.innerHTML = '';
        categories.forEach(category => {
            const button = document.createElement('button');
            button.className = 'category-button transition-all-smooth';
            button.textContent = category;
            button.dataset.category = category;
            categoryButtonsContainer.appendChild(button);
        });
    }

    function renderProductsLoadingState() {
        productListContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px 0;"><i class="fas fa-spinner fa-spin" style="font-size: 3rem; color: var(--color-primario);"></i><p style="margin-top: 1rem;">Cargando productos...</p></div>`;
    }

    function renderProductsErrorState() {
        const loadingMessage = document.getElementById('category-loading-message');
        if (loadingMessage) loadingMessage.textContent = 'Error al cargar categorías.';
        productListContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px 0; color: var(--color-primario);"><i class="fas fa-exclamation-triangle" style="font-size: 3rem;"></i><p style="margin-top: 1rem; font-weight: 600;">¡Ups! No pudimos cargar el menú.</p><p style="color: var(--color-texto-secundario);">Por favor, intenta de nuevo más tarde.</p></div>`;
    }

    function setActiveCategoryButton(category) {
        document.querySelectorAll('.category-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
    }

    // --- MODALES ---
    function showModal(modalElement) {
        modalElement.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(modalElement) {
        modalElement.classList.remove('show');
        if (modalElement === orderStatusModal) stopOrderPolling();
        if (modalElement === cartModal) resetGpsCapture();
        if (!document.querySelector('.modal.show')) {
            document.body.style.overflow = 'auto';
        }
    }

    function showCustomAlert(message) {
        customAlertMessage.textContent = message;
        showModal(customAlert);
    }

    // --- LÓGICA DEL CARRUSEL ---
    function nextHeroSlide() {
        const slides = heroSection.querySelectorAll('.hero-slide');
        if (slides.length <= 1) return;
        slides[currentHeroSlide].classList.remove('active');
        currentHeroSlide = (currentHeroSlide + 1) % slides.length;
        slides[currentHeroSlide].classList.add('active');
    }

    function startHeroCarousel() {
        if (heroSection.querySelectorAll('.hero-slide').length > 1) {
            heroCarouselInterval = setInterval(nextHeroSlide, 5000);
        }
    }

    // --- LÓGICA DE PRODUCTOS Y PERSONALIZACIÓN ---
    function openProductModal(productId) {
        currentModalProduct = allProducts.find(p => p.id === productId);
        if (!currentModalProduct) return;
        if (currentModalProduct.stock <= 0) {
            showCustomAlert('Este producto está agotado por el momento.');
            return;
        }

        modalImg.src = currentModalProduct.imageUrl;
        modalName.textContent = currentModalProduct.name;
        modalDetailedDescription.textContent = currentModalProduct.detailedDescription || '';
        modalSpecialInstructions.value = '';
        renderCustomizationOptions();
        updateModalPrice();
        showModal(productModal);
    }

    function renderCustomizationOptions() {
        modalCustomizationSection.innerHTML = '';
        if (currentModalProduct.customizationOptions?.length > 0) {
            currentModalProduct.customizationOptions.forEach((group, groupIndex) => {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'customization-group';
                let optionsHtml = group.options.map((option, optionIndex) => {
                    const optionId = `custom-${group.type}-${groupIndex}-${optionIndex}`;
                    const isChecked = group.type === 'radio' && option.id === group.defaultOption ? 'checked' : '';
                    const priceDisplay = option.price > 0 ? `<span class="customization-option-price">+ ${formatPrice(option.price)}</span>` : '';

                    return `
                        <div class="customization-option-item">
                            <label for="${optionId}">
                                <input type="${group.type}" id="${optionId}" name="custom-group-${groupIndex}" data-price="${option.price || 0}" data-name="${option.name}" ${isChecked}>
                                ${option.name}
                            </label>
                            ${priceDisplay}
                        </div>
                    `;
                }).join('');

                groupDiv.innerHTML = `
                    <h4 class="customization-group-title">${group.groupTitle}</h4>
                    <div class="customization-options-container">${optionsHtml}</div>
                `;
                modalCustomizationSection.appendChild(groupDiv);
            });
        } else {
            modalCustomizationSection.innerHTML = '<p style="font-size: 0.875rem; color: var(--color-texto-secundario);">Este producto no tiene personalización.</p>';
        }
    }

    function updateModalPrice() {
        if (!currentModalProduct) return;
        let basePrice = (currentModalProduct.isOffer && currentModalProduct.offerPrice) ? currentModalProduct.offerPrice : currentModalProduct.price;
        let customizationTotal = 0;

        modalCustomizationSection.querySelectorAll('input:checked').forEach(input => {
            customizationTotal += parseFloat(input.dataset.price);
        });
        modalPriceElement.textContent = formatPrice(basePrice + customizationTotal);
    }

    // --- LÓGICA DEL CARRITO DE COMPRAS ---
    function addToCartFromModal() {
        const selectedCustomizations = [];
        modalCustomizationSection.querySelectorAll('input:checked').forEach(input => {
            selectedCustomizations.push({
                name: input.dataset.name,
                price: parseFloat(input.dataset.price)
            });
        });

        const instructions = modalSpecialInstructions.value.trim();
        const basePrice = (currentModalProduct.isOffer && currentModalProduct.offerPrice) ? currentModalProduct.offerPrice : currentModalProduct.price;
        const finalPricePerUnit = basePrice + selectedCustomizations.reduce((sum, cust) => sum + cust.price, 0);

        const itemIdentifier = `${currentModalProduct.id}-${JSON.stringify(selectedCustomizations.map(s => s.name).sort())}-${instructions}`;

        const existingItem = cart.find(item => item.identifier === itemIdentifier);

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cart.push({
                identifier: itemIdentifier,
                id: currentModalProduct.id,
                name: currentModalProduct.name,
                imageUrl: currentModalProduct.imageUrl,
                quantity: 1,
                selectedCustomizations,
                instructions,
                finalPricePerUnit
            });
        }

        updateCartOnUIAndStorage();
        showCustomAlert(`"${currentModalProduct.name}" añadido al carrito.`);
        closeModal(productModal);
    }

    function updateCartItemQuantity(index, newQuantity) {
        if (newQuantity <= 0) {
            cart.splice(index, 1);
        } else {
            cart[index].quantity = newQuantity;
        }
        updateCartOnUIAndStorage();
    }

    function clearCart() {
        cart = [];
        resetGpsCapture();
        updateCartOnUIAndStorage();
    }

    function updateCartOnUIAndStorage() {
        renderCartItems();
        updateCartCount();
        saveCartToLocalStorage();
    }

    function openCartModal() {
        resetGpsCapture();
        renderCartItems();
        showModal(cartModal);
    }

    function renderCartItems() {
        cartItemsContainer.innerHTML = '';
        let totalCartPrice = 0;

        if (cart.length === 0) {
            emptyCartMessage.style.display = 'block';
            clearCartBtn.style.display = 'none';
        } else {
            emptyCartMessage.style.display = 'none';
            clearCartBtn.style.display = 'inline-flex';
            cart.forEach((item, index) => {
                const itemFinalPrice = item.finalPricePerUnit * item.quantity;
                totalCartPrice += itemFinalPrice;

                let customizationHtml = '';
                if (item.selectedCustomizations.length > 0) {
                    customizationHtml += `<p class="cart-item-customizations">Extras: ${item.selectedCustomizations.map(c => c.name).join(', ')}</p>`;
                }
                if (item.instructions) {
                   customizationHtml += `<p class="cart-item-customizations"><i>Instrucciones: ${item.instructions}</i></p>`;
                }

                const cartItemDiv = document.createElement('div');
                cartItemDiv.className = 'cart-item';
                cartItemDiv.innerHTML = `
                    <img src="${item.imageUrl}" alt="${item.name}" class="cart-item-img">
                    <div class="cart-item-details">
                        <h4>${item.name}</h4>
                        <p class="cart-item-unit-price">${formatPrice(item.finalPricePerUnit)} c/u</p>
                        ${customizationHtml}
                    </div>
                    <div class="cart-item-quantity-controls">
                        <button class="cart-item-quantity-btn decrease-quantity" data-index="${index}">-</button>
                        <span>${item.quantity}</span>
                        <button class="cart-item-quantity-btn increase-quantity" data-index="${index}">+</button>
                    </div>
                    <p class="cart-item-total-price">${formatPrice(itemFinalPrice)}</p>
                    <button class="cart-item-remove-btn" data-index="${index}"><i class="fas fa-trash-alt"></i></button>
                `;
                cartItemsContainer.appendChild(cartItemDiv);
            });
        }
        cartTotalPriceElement.textContent = formatPrice(totalCartPrice);
    }

    function updateCartCount() {
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        cartCountElement.textContent = totalItems;
        checkoutBtn.disabled = totalItems === 0;
        clearCartBtn.disabled = totalItems === 0;
        if (totalItems > 0 && cart.length > 0) {
            cartCountElement.classList.add('active');
            cartCountElement.style.transform = 'scale(1.2)';
            setTimeout(() => cartCountElement.style.transform = 'scale(1)', 200);
        } else {
            cartCountElement.classList.remove('active');
        }
    }

    // --- GUARDAR PEDIDO EN SUPABASE Y ENVIAR POR WHATSAPP ---

    function captureGpsLocation() {
        if (!navigator.geolocation) {
            gpsStatus.textContent = 'Tu navegador no soporta geolocalización.';
            useGpsBtn.disabled = true;
            useGpsBtn.innerHTML = '<i class="fas fa-times-circle"></i> GPS no disponible';
            return Promise.reject(new Error('Geolocation not supported'));
        }

        if (capturedLat && capturedLng) {
            gpsStatus.textContent = 'Ubicación ya capturada.';
            return Promise.resolve({ lat: capturedLat, lng: capturedLng });
        }

        useGpsBtn.disabled = true;
        useGpsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo ubicación...';
        gpsStatus.textContent = 'Obteniendo ubicación precisa...';

        gpsCapturePromise = new Promise((resolve, reject) => {
            gpsCaptureResolve = resolve;
            gpsCaptureReject = reject;

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    capturedLat = pos.coords.latitude;
                    capturedLng = pos.coords.longitude;
                    gpsStatus.textContent = '✅ Ubicación capturada con precisión ' + Math.round(pos.coords.accuracy) + 'm';
                    useGpsBtn.innerHTML = '<i class="fas fa-check-circle"></i> Ubicación capturada';
                    useGpsBtn.classList.add('gps-captured');
                    resolve({ lat: capturedLat, lng: capturedLng });
                },
                (err) => {
                    let msg = 'No se pudo obtener tu ubicación. ';
                    if (err.code === err.PERMISSION_DENIED) {
                        msg += 'Permiso denegado. Puedes escribir la dirección manualmente.';
                    } else if (err.code === err.TIMEOUT) {
                        msg += 'Tiempo agotado. Intenta de nuevo o escribe la dirección.';
                    } else {
                        msg += 'Error: ' + err.message + '. Puedes seguir solo con la dirección escrita.';
                    }
                    gpsStatus.textContent = msg;
                    useGpsBtn.disabled = false;
                    useGpsBtn.innerHTML = '<i class="fas fa-location-crosshairs"></i> Usar mi ubicación actual';
                    useGpsBtn.classList.remove('gps-captured');
                    reject(err);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });

        return gpsCapturePromise;
    }

    function resetGpsCapture() {
        capturedLat = null;
        capturedLng = null;
        gpsCapturePromise = null;
        gpsCaptureResolve = null;
        gpsCaptureReject = null;
        useGpsBtn.disabled = false;
        useGpsBtn.innerHTML = '<i class="fas fa-location-crosshairs"></i> Usar mi ubicación actual';
        useGpsBtn.classList.remove('gps-captured');
        gpsStatus.textContent = '';
    }

    async function sendOrderViaWhatsApp() {
        const address = deliveryAddressInput.value.trim();
        if (cart.length === 0) {
            showCustomAlert('Tu carrito está vacío.');
            return;
        }
        if (!address) {
            showCustomAlert('Por favor, ingresa tu dirección de entrega.');
            deliveryAddressInput.focus();
            return;
        }

        // Si hay una captura GPS en progreso, esperarla (máx 5s extra)
        if (gpsCapturePromise) {
            checkoutBtn.disabled = true;
            checkoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Esperando GPS...';
            try {
                await Promise.race([
                    gpsCapturePromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('GPS timeout')), 5000))
                ]);
            } catch (e) {
                // GPS falló o tardó demasiado: continuar solo con dirección
                console.warn('GPS no disponible al enviar, continuando con dirección:', e.message);
            }
        }

        const total = cart.reduce((sum, item) => sum + item.finalPricePerUnit * item.quantity, 0);

        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

        try {
            const orderItemsPayload = cart.map(item => ({
                product_id: item.id,
                product_name: item.name,
                quantity: item.quantity,
                unit_price: item.finalPricePerUnit,
                customizations: item.selectedCustomizations,
                instructions: item.instructions || null
            }));

            const { data: orderId, error: orderError } = await supabase.rpc('create_order', {
                p_delivery_address: address,
                p_total: total,
                p_items: orderItemsPayload,
                p_lat: capturedLat,
                p_lng: capturedLng,
                p_customer_phone: customerPhoneInput ? customerPhoneInput.value.trim() : null
            });

            if (orderError) throw orderError;

            await continueOrderFlow(orderId, address, total, cart);

        } catch (error) {
            console.error('Error al registrar el pedido en Supabase:', error);
            showCustomAlert('No pudimos registrar tu pedido. Por favor intenta de nuevo.');
        } finally {
            checkoutBtn.disabled = cart.length === 0;
            checkoutBtn.innerHTML = '<i class="fab fa-whatsapp"></i> Enviar Pedido';
        }
    }

    async function continueOrderFlow(orderId, address, total, orderItems) {
        const shortId = orderId.slice(0, 8).toUpperCase();
        let message = `¡Hola! 👋 Quiero confirmar mi pedido *#${shortId}*:\n\n`;
        message += `*DIRECCIÓN DE ENTREGA:*\n${address}\n\n`;
        message += `*PEDIDO:*\n`;
        orderItems.forEach(item => {
            message += `*${item.quantity}x - ${item.name}* (${formatPrice(item.finalPricePerUnit)})\n`;
            if (item.selectedCustomizations.length > 0) {
                message += `  - Extras: ${item.selectedCustomizations.map(c => c.name).join(', ')}\n`;
            }
            if (item.instructions) {
                message += `  - Instrucciones: ${item.instructions}\n`;
            }
            message += `\n`;
        });
        message += `*TOTAL DEL PEDIDO: ${formatPrice(total)}*`;

        const encodedMessage = encodeURIComponent(message);
        const whatsappUrl = `https://wa.me/${config.whatsappNumber}?text=${encodedMessage}`;
        window.open(whatsappUrl, '_blank');

        trackedOrderIds = [orderId, ...trackedOrderIds.filter(id => id !== orderId)].slice(0, 10);
        localStorage.setItem('trackedOrders', JSON.stringify(trackedOrderIds));
        localStorage.setItem('lastOrderId', orderId);
        trackedOrderId = orderId;
        trackOrderButton.style.display = 'inline-flex';

        showCustomAlert('Tu pedido fue registrado y enviado por WhatsApp. ¡Gracias por tu compra!');
        clearCart();
        closeModal(cartModal);
    }

    // --- SEGUIMIENTO DE PEDIDOS EN TIEMPO REAL ---
    function initOrderTracking() {
        if (trackedOrderIds.length > 0) {
            trackOrderButton.style.display = 'inline-flex';
        }
    }

    function openOrderStatusModal() {
        if (trackedOrderIds.length === 0) return;
        selectedOrderId = selectedOrderId || trackedOrderIds[0];
        showModal(orderStatusModal);
        renderOrderStatusList();
        refreshTrackedOrders();
        subscribeToOrderStatus(selectedOrderId);
    }

    async function refreshTrackedOrders() {
        for (const id of trackedOrderIds) {
            const { data, error } = await supabase.rpc('get_order_status', { order_id: id });
            if (!error && data && data.length > 0) {
                orderStatuses[id] = data[0].status;
                orderTotals[id] = data[0].total;
            }
        }
        renderOrderStatusList();
        if (selectedOrderId) {
            renderOrderStatus(orderStatuses[selectedOrderId] || 'recibido', selectedOrderId);
        }
    }

    function renderOrderStatusList() {
        if (trackedOrderIds.length === 0) {
            orderStatusList.innerHTML = '<p style="color: var(--color-texto-secundario);">No hay pedidos registrados en este dispositivo.</p>';
            orderStatusTimeline.style.display = 'none';
            orderStatusCancelledMsg.style.display = 'none';
            if (orderRiderInfo) orderRiderInfo.style.display = 'none';
            orderStatusShortId.textContent = '';
            orderStatusTotal.textContent = '';
            updateConfirmReceiptButton();
            return;
        }
        orderStatusList.innerHTML = trackedOrderIds.map(id => {
            const status = orderStatuses[id] || 'recibido';
            const label = ORDER_STATUS_LABELS[status] || status;
            const total = orderTotals[id];
            return `<button type="button" class="tracked-order-item${id === selectedOrderId ? ' active' : ''}" data-order-id="${id}">
                <span class="tracked-order-info">
                    <span class="tracked-order-id">Pedido #${id.slice(0, 8).toUpperCase()}</span>
                    ${total ? `<span class="tracked-order-total">${formatPrice(total)}</span>` : ''}
                </span>
                <span class="tracked-order-status">${label}</span>
            </button>`;
        }).join('');
        updateConfirmReceiptButton();
    }

    function selectTrackedOrder(orderId) {
        selectedOrderId = orderId;
        renderOrderStatusList();
        subscribeToOrderStatus(orderId);
    }

    async function refreshSingleOrderStatus(orderId) {
        const { data, error } = await supabase.rpc('get_order_status', { order_id: orderId });
        if (!error && data && data.length > 0) {
            orderStatuses[orderId] = data[0].status;
            orderTotals[orderId] = data[0].total;
            renderOrderStatusList();
            if (selectedOrderId === orderId) {
                renderOrderStatus(data[0].status, orderId);
            }
        }
    }

    function stopOrderPolling() {
        if (orderPollingInterval) {
            clearInterval(orderPollingInterval);
            orderPollingInterval = null;
        }
    }

    function subscribeToOrderStatus(orderId) {
        if (orderRealtimeChannel) {
            supabase.removeChannel(orderRealtimeChannel);
            orderRealtimeChannel = null;
        }
        stopOrderPolling();

        refreshSingleOrderStatus(orderId);

        orderRealtimeChannel = supabase
            .channel(`order-status-${orderId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: `id=eq.${orderId}`
            }, payload => {
                orderStatuses[orderId] = payload.new.status;
                renderOrderStatusList();
                if (selectedOrderId === orderId) {
                    renderOrderStatus(payload.new.status, orderId);
                }
            })
            .subscribe();

        // Respaldo por polling: si Realtime no está habilitado en la tabla
        // 'orders' o el cliente es anónimo (RLS bloquea el evento), esto
        // garantiza que el cliente vea el cambio de estado igualmente.
        orderPollingInterval = setInterval(() => refreshSingleOrderStatus(orderId), 5000);
    }

    function renderOrderStatus(status, orderId) {
        orderStatusShortId.textContent = orderId.slice(0, 8).toUpperCase();
        orderStatusTotal.textContent = orderTotals[orderId] ? formatPrice(orderTotals[orderId]) : '';

        if (status === 'cancelado') {
            orderStatusTimeline.style.display = 'none';
            orderStatusCancelledMsg.style.display = 'block';
            if (orderRiderInfo) orderRiderInfo.style.display = 'none';
            updateConfirmReceiptButton();
            return;
        }
        orderStatusTimeline.style.display = 'flex';
        orderStatusCancelledMsg.style.display = 'none';

        const mappedStatus = TRACK_STATUS_MAP[status] || status;
        const currentIndex = ORDER_STATUS_STEPS.indexOf(mappedStatus);
        orderStatusTimeline.querySelectorAll('.order-status-step').forEach(stepEl => {
            const stepIndex = ORDER_STATUS_STEPS.indexOf(stepEl.dataset.status);
            stepEl.classList.toggle('completed', stepIndex <= currentIndex);
        });
        updateConfirmReceiptButton();
        loadOrderRiderInfo(status, orderId);
    }

    async function loadOrderRiderInfo(status, orderId) {
        if (!orderRiderInfo) return;
        if (status === 'en_camino' || status === 'entregado') {
            const { data: riderInfo, error } = await supabase.rpc('get_order_rider_info', { p_order_id: orderId });
            if (!error && riderInfo && riderInfo.ok) {
                const vehicleEmoji = { moto: '🏍️', bicicleta: '🚲', carro: '🚗', a_pie: '🚶' }[riderInfo.vehicle_type] || '🏍️';
                const photoSrc = riderInfo.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderInfo.full_name || 'D')}&background=d32f2f&color=fff&size=80`;
                orderRiderInfo.innerHTML = `
                    <div class="rider-info-card">
                        <img src="${photoSrc}" alt="${riderInfo.full_name}" class="rider-info-photo">
                        <div class="rider-info-details">
                            <strong>${riderInfo.full_name || 'Domiciliario'}</strong>
                            <span>${vehicleEmoji} ${riderInfo.vehicle_type || 'Moto'}</span>
                            ${riderInfo.id_number ? `<span><i class="fas fa-id-card"></i> C.C. ${riderInfo.id_number}</span>` : ''}
                            <span>⭐ ${(riderInfo.rating || 5).toFixed(1)} · ${riderInfo.total_deliveries || 0} entregas</span>
                            ${riderInfo.phone ? `<a href="tel:${riderInfo.phone}" class="btn btn-secondary btn-sm"><i class="fas fa-phone"></i> Llamar</a>` : ''}
                        </div>
                    </div>
                `;
                orderRiderInfo.style.display = 'block';
            } else {
                orderRiderInfo.style.display = 'none';
            }
        } else {
            orderRiderInfo.style.display = 'none';
        }
    }

    function updateConfirmReceiptButton() {
        const status = orderStatuses[selectedOrderId];
        // El botón de confirmar entrega solo aparece cuando el pedido está REALMENTE "en_camino" o "entregado".
        // 'buscando_domiciliario' activa el paso visual "En camino" pero el domiciliario aún no ha aceptado:
        // no se puede confirmar la entrega todavía.
        const isOnTheWay = status === 'en_camino' || status === 'entregado';
        if (selectedOrderId && status && isOnTheWay) {
            confirmReceiptBtn.style.display = 'inline-flex';
            confirmReceiptBtn.disabled = false;
        } else {
            confirmReceiptBtn.style.display = 'none';
        }
    }

    async function confirmOrderReceived() {
        if (!selectedOrderId) return;
        confirmReceiptBtn.disabled = true;
        const { data, error } = await supabase.rpc('confirm_order_received', { p_order_id: selectedOrderId });
        if (error) {
            console.error('Error confirmando pedido:', error);
            showCustomAlert('No pudimos confirmar tu pedido. Intenta de nuevo.');
            confirmReceiptBtn.disabled = false;
            return;
        }
        if (data === false) {
            showCustomAlert('Este pedido aún no está en camino. Espera a que el domiciliario lo tome.');
            refreshTrackedOrders();
            return;
        }
        showCustomAlert('¡Gracias! Tu pedido fue marcado como entregado.');
        refreshTrackedOrders();
    }

    function forgetTrackedOrders() {
        localStorage.removeItem('trackedOrders');
        localStorage.removeItem('lastOrderId');
        trackedOrderIds = [];
        trackedOrderId = null;
        selectedOrderId = null;
        if (orderRealtimeChannel) {
            supabase.removeChannel(orderRealtimeChannel);
            orderRealtimeChannel = null;
        }
        stopOrderPolling();
        trackOrderButton.style.display = 'none';
        closeModal(orderStatusModal);
    }

    // --- MANEJADORES DE EVENTOS (EVENT LISTENERS) ---
    function addEventListeners() {
        viewMenuHeroBtn.addEventListener('click', () => menuSection.scrollIntoView({ behavior: 'smooth' }));
        cartIconButton.addEventListener('click', openCartModal);
        trackOrderButton.addEventListener('click', openOrderStatusModal);

        // Cierre de Modales
        closeModalBtn.addEventListener('click', () => closeModal(productModal));
        closeCartModalBtn.addEventListener('click', () => closeModal(cartModal));
        customAlertCloseBtn.addEventListener('click', () => closeModal(customAlert));
        closeOrderStatusModalBtn.addEventListener('click', () => closeModal(orderStatusModal));
        closeAuthModalBtn.addEventListener('click', () => closeModal(authModal));
        forgetOrderBtn.addEventListener('click', forgetTrackedOrders);
        orderStatusList.addEventListener('click', e => {
            const item = e.target.closest('.tracked-order-item');
            if (item) selectTrackedOrder(item.dataset.orderId);
        });
        confirmReceiptBtn.addEventListener('click', confirmOrderReceived);

        // Cierre con Escape y click fuera
        window.addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelectorAll('.modal.show').forEach(closeModal));
        window.addEventListener('click', (e) => {
            if(e.target.classList.contains('modal')) closeModal(e.target);
            if (!userMenuButton.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.style.display = 'none';
            }
        });
        
        userMenuButton.addEventListener('click', toggleAuthModal);

        myOrdersBtn.addEventListener('click', () => {
            userDropdown.style.display = 'none';
            openOrderStatusModal();
        });

        flashBannerClose.addEventListener('click', hideFlashBanner);
        flashBanner.addEventListener('click', (e) => {
            if (e.target.closest('.flash-banner-close')) return;
            menuSection.scrollIntoView({ behavior: 'smooth' });
        });

        authToggleBtn.addEventListener('click', () => {
            isSignupMode = !isSignupMode;
            authError.textContent = '';
            if (isSignupMode) {
                authNameGroup.style.display = 'flex';
                authNameInput.setAttribute('required', 'true');
                authSubmitBtn.textContent = 'Registrarse';
                authToggleMessage.textContent = '¿Ya tienes cuenta?';
                authToggleBtn.textContent = 'Inicia Sesión';
            } else {
                authNameGroup.style.display = 'none';
                authNameInput.removeAttribute('required');
                authSubmitBtn.textContent = 'Iniciar Sesión';
                authToggleMessage.textContent = '¿No tienes cuenta?';
                authToggleBtn.textContent = 'Regístrate';
            }
        });

        googleLoginBtn.addEventListener('click', async () => {
            try {
                const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
                if (error) throw error;
            } catch (error) {
                authError.textContent = 'Error al conectar con Google.';
                console.error(error);
            }
        });

        authEmailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            authError.textContent = '';
            authSubmitBtn.disabled = true;
            
            const email = authEmailInput.value;
            const password = authPasswordInput.value;
            const fullName = authNameInput.value;

            try {
                if (isSignupMode) {
                    const { error } = await supabase.auth.signUp({
                        email, password, options: { data: { full_name: fullName, role: 'cliente' } }
                    });
                    if (error) throw error;
                    showCustomAlert('Registro exitoso. Revisa tu correo o inicia sesión.');
                    closeModal(authModal);
                } else {
                    const { error } = await supabase.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                    closeModal(authModal);
                }
            } catch (error) {
                authError.textContent = error.message;
            } finally {
                authSubmitBtn.disabled = false;
            }
        });

        logoutClientBtn.addEventListener('click', async () => {
            await supabase.auth.signOut();
            userDropdown.style.display = 'none';
            showCustomAlert('Sesión cerrada correctamente.');
        });

        // Búsqueda y Vistas
        searchInput.addEventListener('input', e => {
            currentSearchTerm = e.target.value;
            renderFilteredProducts();
        });
        gridViewBtn.addEventListener('click', () => applyViewMode('grid'));
        listViewBtn.addEventListener('click', () => applyViewMode('list'));

        // Eventos delegados para elementos dinámicos
        document.body.addEventListener('click', e => {
            const addToCartBtn = e.target.closest('.add-to-cart-btn');
            if (addToCartBtn) {
                openProductModal(addToCartBtn.dataset.productId);
                return;
            }

            const categoryBtn = e.target.closest('.category-button');
            if (categoryBtn) {
                currentCategory = categoryBtn.dataset.category;
                currentCategoryTitleElement.textContent = currentCategory === 'Todas' ? 'Todos los Productos' : currentCategory;
                setActiveCategoryButton(currentCategory);
                renderFilteredProducts();
                return;
            }

            const cartBtn = e.target.closest('button');
            if (cartItemsContainer.contains(cartBtn)) {
                const index = parseInt(cartBtn.dataset.index);
                if (cartBtn.classList.contains('increase-quantity')) {
                    updateCartItemQuantity(index, cart[index].quantity + 1);
                } else if (cartBtn.classList.contains('decrease-quantity')) {
                    updateCartItemQuantity(index, cart[index].quantity - 1);
                } else if (cartBtn.classList.contains('cart-item-remove-btn')) {
                    updateCartItemQuantity(index, 0); // Setting quantity to 0 removes it
                }
            }
        });

        // Modal de Producto
        modalCustomizationSection.addEventListener('change', updateModalPrice);
        modalConfirmBtn.addEventListener('click', addToCartFromModal);

        // Modal de Carrito
        deliveryAddressInput.addEventListener('input', saveAddressToLocalStorage);
        continueShoppingBtn.addEventListener('click', () => closeModal(cartModal));
        clearCartBtn.addEventListener('click', () => {
             if (confirm('¿Estás seguro de que quieres vaciar tu carrito?')) {
                clearCart();
            }
        });
        checkoutBtn.addEventListener('click', sendOrderViaWhatsApp);
        useGpsBtn.addEventListener('click', async () => {
            try {
                await captureGpsLocation();
            } catch (e) {
                // Error ya manejado dentro de captureGpsLocation
            }
        });

        // Permitir recapturar GPS si ya se capturó
        useGpsBtn.addEventListener('dblclick', resetGpsCapture);

        shareAppBtn.addEventListener('click', () => {
            const message = '¡Vengan a probar la comida más rica de DeliciasExpress! 🍔🍕🔥 Hamburguesas, pizza, ensaladas y mucho más, todo delicioso y a un clic de distancia. ¡Los esperamos! 😋\n\n' + window.location.href;
            if (navigator.share) {
                navigator.share({ title: 'DeliciasExpress', text: message, url: window.location.href }).catch(() => {});
            } else {
                window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank');
            }
        });
    }

    // --- AUTENTICACIÓN ---
    async function checkAuthState() {
        const { data: { session } } = await supabase.auth.getSession();
        currentUser = session?.user || null;
        updateUserUI();

        supabase.auth.onAuthStateChange((event, session) => {
            currentUser = session?.user || null;
            updateUserUI();
        });
    }

    function updateUserUI() {
        if (currentUser) {
            userMenuButton.innerHTML = '<i class="fas fa-user-check" style="color: var(--color-primario);"></i>';
            const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
            userDropdownName.textContent = `Hola, ${name}`;
        } else {
            userMenuButton.innerHTML = '<i class="fas fa-user-circle"></i>';
            userDropdown.style.display = 'none';
        }
    }

    function toggleAuthModal() {
        if (currentUser) {
            userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
        } else {
            showModal(authModal);
            resetAuthForm();
        }
    }

    function resetAuthForm() {
        isSignupMode = false;
        authEmailForm.reset();
        authError.textContent = '';
        authNameGroup.style.display = 'none';
        authNameInput.removeAttribute('required');
        authSubmitBtn.textContent = 'Iniciar Sesión';
        authToggleMessage.textContent = '¿No tienes cuenta?';
        authToggleBtn.textContent = 'Regístrate';
    }

    // --- FUNCIONES DE UTILIDAD ---
    function formatPrice(price) {
        return price.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    }

    // --- INICIALIZACIÓN DE LA APP ---
    initialize();
});
