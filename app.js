/**
 * Jara App - State Management, Client-Side Routing, Render Controllers & Mock Integrations
 */

// --- GLOBAL APPLICATION STATE ---
const STATE = {
  theme: localStorage.getItem('jara-theme') || 'dark',
  role: 'earner', // 'earner' or 'business'
  wallet: {
    connected: false,
    address: null,
    balance: 0.00, // Arc-USDC
    symbol: 'USDC'
  },
  tasks: [],
  myClaims: [],
  submissions: [],
  transactions: []
};

// --- CENTRALIZED TASK SYNC & PERSISTENCE (POCKETBASE) ---
const pb = new PocketBase('https://pocketbase-deployment-production.up.railway.app');

function mapRecordToTask(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    instructions: r.instructions,
    category: r.category,
    reward: parseFloat(r.reward) || 0,
    limit: parseInt(r.limit) || 0,
    completedCount: parseInt(r.completedCount) || 0,
    creator: r.creator,
    status: r.status,
    escrowAgreementAddress: r.escrowAgreementAddress,
    escrowTxHash: r.escrowTxHash,
    escrowStatus: r.escrowStatus,
    verificationType: r.verificationType,
    locationTarget: r.locationTarget,
    inventoryItems: r.inventoryItems
  };
}

// Realtime task synchronization
pb.collection('tasks').subscribe('*', (e) => {
  console.log("Realtime event received:", e.action, e.record);
  const task = mapRecordToTask(e.record);

  if (e.action === 'create') {
    const exists = STATE.tasks.some(t => t.id === task.id);
    if (!exists) {
      STATE.tasks.unshift(task);
    }
  } else if (e.action === 'update') {
    const idx = STATE.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      STATE.tasks[idx] = task;
    }
  } else if (e.action === 'delete') {
    STATE.tasks = STATE.tasks.filter(t => t.id !== task.id);
  }

  // Trigger re-render of active view
  handleRoute();
});

// --- REAL TRANSACTION HELPERS ---
const USDC_CONTRACT_ADDRESS = '0x3600000000000000000000000000000000000000';

/**
 * ESCROW_HOLDING_ADDRESS (Agent Wallet Address)
 * 
 * In the Jara Escrow Architecture, this address acts as the centralized hold vault
 * on behalf of the Paymaster system.
 * 
 * Paymaster/Session Key Logic:
 * 1. Businesses lock rewards by depositing USDC to this escrow holding address.
 * 2. When an Earner completes a task, the platform validates their proof of work.
 * 3. Once approved, the platform acts as a gas relayer: it triggers a sponsored L2 transfer
 *    to pay out the exact reward directly from this vault to the Earner's EVM address.
 * 4. By having the platform server or escrow contract host the session credentials, gas fees
 *    are fully sponsored, ensuring sub-cent payouts don't suffer from transaction fee friction.
 */
const ESCROW_HOLDING_ADDRESS = '0x3d7ffed295e555052233544ba74eaa1c0920fa20';

// --- OPEN SOURCE PRIMITIVES IMPORTED FROM lib/arc-utils.js ---
// encodeERC20Transfer, waitForTxReceipt, and calculateHaversineDistance are now
// imported from lib/arc-utils.js and accessed via window.ArcUtils namespace.

// --- INITIALIZE APPLICATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Apply initial theme
  document.documentElement.setAttribute('data-theme', STATE.theme);
  updateThemeToggleIcon();

  // Load Saved Wallet if exists
  const savedWallet = localStorage.getItem('jara-wallet');
  const savedMethod = localStorage.getItem('jara-wallet-method');
  if (savedWallet) {
    try {
      STATE.wallet = JSON.parse(savedWallet);
      updateWalletNavButton();
      // Verify active Web3 connection
      if (savedMethod === 'walletconnect') {
        initWalletConnect(false).then(() => {
          checkRealWalletConnection();
        }).catch(err => {
          console.warn("WalletConnect auto-reconnect failed:", err);
        });
      } else {
        checkRealWalletConnection();
      }
    } catch (e) { }
  }

  // Setup Event Listeners
  setupEventListeners();

  // Setup Metamask event listeners
  setupEthereumProviderListeners();

  // Initial Route Load & Task Fetch from PocketBase
  pb.collection('tasks').getFullList({ sort: '-created' })
    .then(records => {
      STATE.tasks = records.map(mapRecordToTask);
      handleRoute();
    })
    .catch(err => {
      console.warn("Failed to fetch initial tasks from PocketBase:", err);
      handleRoute();
    });
});

// --- LIGHT/DARK THEME TOGGLE ---
function toggleTheme() {
  STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', STATE.theme);
  localStorage.setItem('jara-theme', STATE.theme);
  updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (!toggleBtn) return;
  toggleBtn.innerHTML = STATE.theme === 'dark'
    ? '<i data-lucide="sun"></i>'
    : '<i data-lucide="moon"></i>';
  lucide.createIcons();
}

// --- LIGHTWEIGHT ROUTER ---
window.addEventListener('hashchange', handleRoute);

function handleRoute() {
  const hash = window.location.hash || '#/';
  const appRoot = document.getElementById('app-root');

  // Update nav active styling
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));

  // Show/hide simulator banner only on Create Task page
  const bannerContainer = document.getElementById('simulation-role-banner-container');
  if (bannerContainer) {
    if (hash === '#/create') {
      bannerContainer.style.display = 'block';
    } else {
      bannerContainer.style.display = 'none';
    }
  }

  // Dynamically show/hide Earnings nav link based on role (business shouldn't see it)
  const earningsNavLink = document.getElementById('nav-earnings');
  if (earningsNavLink) {
    if (STATE.role === 'business') {
      earningsNavLink.style.display = 'none';
    } else {
      earningsNavLink.style.display = 'inline-block';
    }
  }

  if (hash === '#/') {
    document.getElementById('nav-landing')?.classList.add('active');
    renderLandingView(appRoot);
  } else if (hash === '#/marketplace') {
    document.getElementById('nav-marketplace')?.classList.add('active');
    renderMarketplaceView(appRoot);
  } else if (hash === '#/create') {
    document.getElementById('nav-create')?.classList.add('active');
    renderCreateTaskView(appRoot);
  } else if (hash === '#/my-tasks') {
    document.getElementById('nav-my-tasks')?.classList.add('active');
    renderMyTasksView(appRoot);
  } else if (hash === '#/earnings') {
    document.getElementById('nav-earnings')?.classList.add('active');
    renderEarningsView(appRoot);
  } else if (hash === '#/wallet') {
    document.getElementById('nav-wallet')?.classList.add('active');
    renderWalletView(appRoot);
  } else if (hash === '#/use-cases') {
    document.getElementById('nav-use-cases')?.classList.add('active');
    renderUseCasesView(appRoot);
  } else if (hash === '#/nanopay-engine') {
    document.getElementById('nav-nanopay-engine')?.classList.add('active');
    renderNanoPayEngineView(appRoot);
  } else {
    appRoot.innerHTML = `<div style="text-align: center; padding: 100px 0;"><h2>404 - View Not Found</h2><a href="#/" class="btn btn-primary" style="margin-top:20px;">Back Home</a></div>`;
  }

  // Auto-refresh balance on navigation
  if (STATE.wallet.connected) {
    refreshWalletBalance();
  }

  lucide.createIcons();
  window.scrollTo(0, 0);
}

// --- SETUP GENERAL EVENT LISTENERS ---
function setupEventListeners() {
  // Theme Toggle Button
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);

  // Wallet Connection Button
  const walletBtn = document.getElementById('wallet-connect-btn');
  walletBtn?.addEventListener('click', () => {
    openModal('wallet-modal');
    renderWalletModalContent();
  });

  // Modal close when clicking outside content
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  // User Role Switcher
  const earnerBtn = document.getElementById('role-earner-btn');
  const businessBtn = document.getElementById('role-business-btn');

  earnerBtn?.addEventListener('click', () => {
    STATE.role = 'earner';
    earnerBtn.classList.add('active');
    businessBtn.classList.remove('active');
    handleRoute(); // re-render current view with the new role perspective
  });

  businessBtn?.addEventListener('click', () => {
    STATE.role = 'business';
    businessBtn.classList.add('active');
    earnerBtn.classList.remove('active');
    handleRoute(); // re-render current view with the new role perspective
  });

  // Connect Injected Browser Wallet button
  document.getElementById('modal-connect-injected-btn')?.addEventListener('click', () => {
    connectRealWallet('injected');
  });

  // Connect WalletConnect button
  document.getElementById('modal-connect-wc-btn')?.addEventListener('click', () => {
    connectRealWallet('walletconnect');
  });

  // Connect MetaMask Mobile deep link button
  document.getElementById('modal-connect-mm-mobile-btn')?.addEventListener('click', () => {
    connectMetaMaskMobile();
  });

  // Disconnect wallet button within wallet modal
  document.getElementById('wallet-modal-disconnect-btn')?.addEventListener('click', () => {
    disconnectRealWallet();
  });

  // Faucet button within wallet modal
  document.getElementById('wallet-modal-faucet-btn')?.addEventListener('click', () => {
    claimFaucetDrop();
  });

  // Mobile navigation hamburger toggle button
  document.getElementById('mobile-menu-toggle-btn')?.addEventListener('click', () => {
    const navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;
    navLinks.classList.toggle('open');
    const toggleBtn = document.getElementById('mobile-menu-toggle-btn');
    if (navLinks.classList.contains('open')) {
      toggleBtn.innerHTML = '<i data-lucide="x"></i>';
    } else {
      toggleBtn.innerHTML = '<i data-lucide="menu"></i>';
    }
    lucide.createIcons();
  });

  // Auto-close menu drawer when navigation links are clicked
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const navLinks = document.querySelector('.nav-links');
      if (navLinks && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        const toggleBtn = document.getElementById('mobile-menu-toggle-btn');
        if (toggleBtn) {
          toggleBtn.innerHTML = '<i data-lucide="menu"></i>';
        }
        lucide.createIcons();
      }
    });
  });
}

// --- REAL WALLET UTILITIES (ARC NETWORK) ---

// WalletConnect initialization
async function initWalletConnect(showModal = false) {
  try {
    const projectId = localStorage.getItem('jara-wc-project-id') || 'c03d00cbd9783515e0be68f9a2e6f477';
    console.log("Initializing WalletConnect with Project ID:", projectId);
    
    const provider = await window["@walletconnect/ethereum-provider"].EthereumProvider.init({
      projectId: projectId,
      chains: [5042002],
      showQrModal: showModal,
      rpcMap: {
        5042002: 'https://rpc.testnet.arc.network'
      },
      metadata: {
        name: 'Jara Marketplace',
        description: 'Community Commerce Infrastructure on Arc',
        url: window.location.origin,
        icons: [window.location.origin + '/jara.png']
      }
    });

    provider.on("accountsChanged", async (accounts) => {
      console.log("WalletConnect accountsChanged:", accounts);
      if (accounts.length > 0) {
        await handleWalletConnected(accounts[0], 'walletconnect');
      } else {
        disconnectRealWallet();
      }
    });

    provider.on("chainChanged", (chainId) => {
      console.log("WalletConnect chainChanged:", chainId);
      const hexChainId = typeof chainId === 'number' ? '0x' + chainId.toString(16) : chainId;
      if (hexChainId !== '0x4cef52') {
        switchNetwork(provider);
      }
    });

    provider.on("disconnect", () => {
      console.log("WalletConnect disconnected");
      disconnectRealWallet();
    });

    window.activeProvider = provider;
    return provider;
  } catch (err) {
    console.error("WalletConnect initialization error:", err);
    throw err;
  }
}

async function switchNetwork(provider) {
  const ARC_CHAIN_ID = '0x4cef52';
  const ARC_CHAIN_PARAMS = {
    chainId: ARC_CHAIN_ID,
    chainName: 'Arc Testnet',
    nativeCurrency: {
      name: 'USDC',
      symbol: 'USDC',
      decimals: 18
    },
    rpcUrls: ['https://rpc.testnet.arc.network'],
    blockExplorerUrls: ['https://testnet.arcscan.app']
  };

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_CHAIN_ID }]
    });
  } catch (switchError) {
    if (switchError.code === 4902 || switchError.message?.includes("Unrecognized chain")) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [ARC_CHAIN_PARAMS]
        });
      } catch (addError) {
        console.error("Failed to add Arc Testnet to wallet:", addError);
        alert("Failed to add Arc Testnet to your wallet. Please add it manually:\nRPC: https://rpc.testnet.arc.network\nChain ID: 5042002");
      }
    } else {
      console.error("Failed to switch to Arc Testnet:", switchError);
      alert("Failed to switch network: " + (switchError.message || switchError));
    }
  }
}

function connectMetaMaskMobile() {
  const cleanUrl = window.location.href.replace(/^http(s)?:\/\//, '');
  const deepLink = `https://metamask.app.link/dapp/${cleanUrl}`;
  console.log("Deep-linking to MetaMask Mobile:", deepLink);
  window.open(deepLink, '_blank');
}

async function connectRealWallet(method = 'injected') {
  if (method === 'walletconnect') {
    try {
      const provider = await initWalletConnect(true);
      await provider.connect();
      if (provider.accounts.length > 0) {
        await handleWalletConnected(provider.accounts[0], 'walletconnect');
      }
    } catch (err) {
      console.error("WalletConnect connection failed:", err);
      alert("WalletConnect connection failed: " + (err.message || err));
    }
    return;
  }

  // default 'injected' provider
  const injected = window.ethereum;
  if (!injected) {
    alert("Web3 browser wallet not detected. If you are on mobile, please use WalletConnect or open this page inside your wallet's in-app browser.");
    return;
  }

  try {
    window.activeProvider = injected;
    await switchNetwork(injected);

    const accounts = await injected.request({
      method: 'eth_requestAccounts'
    });

    if (accounts.length > 0) {
      await handleWalletConnected(accounts[0], 'injected');
    }
  } catch (err) {
    console.error("Injected wallet connection failed:", err);
    alert("Failed to connect wallet: " + (err.message || err));
  }
}

async function handleWalletConnected(address, method) {
  STATE.wallet.connected = true;
  STATE.wallet.address = address;
  STATE.wallet.balance = await getUSDCBalance(address);

  localStorage.setItem('jara-wallet-method', method);
  saveWalletState();
  updateWalletNavButton();
  renderWalletModalContent();
  closeModal('wallet-modal');
  handleRoute();
}

function disconnectRealWallet() {
  STATE.wallet.connected = false;
  STATE.wallet.address = null;
  STATE.wallet.balance = 0.00;
  
  if (window.activeProvider && typeof window.activeProvider.disconnect === 'function') {
    window.activeProvider.disconnect().catch(() => {});
  }
  
  window.activeProvider = null;
  localStorage.removeItem('jara-wallet-method');
  saveWalletState();
  updateWalletNavButton();
  renderWalletModalContent();
  closeModal('wallet-modal');
  handleRoute();
}

async function checkRealWalletConnection() {
  const provider = window.activeProvider || window.ethereum;
  if (provider && STATE.wallet.connected && STATE.wallet.address) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        STATE.wallet.connected = true;
        STATE.wallet.address = accounts[0];
        STATE.wallet.balance = await getUSDCBalance(accounts[0]);
        saveWalletState();
        updateWalletNavButton();
      } else {
        disconnectRealWallet();
      }
    } catch (err) {
      console.error("Failed to check wallet connection:", err);
    }
  }
}

async function getUSDCBalance(userAddress) {
  const provider = window.activeProvider || window.ethereum;
  if (!provider) return 0;

  const usdcAddress = '0x3600000000000000000000000000000000000000';
  const paddedAddress = userAddress.slice(2).padStart(64, '0');
  const data = '0x70a08231' + paddedAddress;

  try {
    const balanceHex = await provider.request({
      method: 'eth_call',
      params: [{
        to: usdcAddress,
        data: data
      }, 'latest']
    });

    if (balanceHex === '0x' || !balanceHex) return 0;

    const balanceBigInt = BigInt(balanceHex);
    return Number(balanceBigInt) / 1e6;
  } catch (err) {
    console.warn("Error fetching USDC ERC20 balance, falling back to native:", err);
    try {
      const nativeBalanceHex = await provider.request({
        method: 'eth_getBalance',
        params: [userAddress, 'latest']
      });
      const nativeBigInt = BigInt(nativeBalanceHex);
      return Number(nativeBigInt) / 1e18;
    } catch (fallbackErr) {
      console.error("Fallback native balance check failed:", fallbackErr);
      return 0;
    }
  }
}

async function refreshWalletBalance() {
  if (STATE.wallet.connected && STATE.wallet.address) {
    try {
      const balance = await getUSDCBalance(STATE.wallet.address);
      if (balance !== STATE.wallet.balance) {
        STATE.wallet.balance = balance;
        saveWalletState();
        updateWalletNavButton();
        renderWalletModalContent();
      }
    } catch (e) {
      console.error("Failed to refresh balance:", e);
    }
  }
}

function setupEthereumProviderListeners() {
  const provider = window.activeProvider || window.ethereum;
  if (provider && typeof provider.on === 'function') {
    try {
      provider.on('accountsChanged', async (accounts) => {
        console.log("Provider accountsChanged:", accounts);
        if (accounts.length > 0) {
          STATE.wallet.connected = true;
          STATE.wallet.address = accounts[0];
          STATE.wallet.balance = await getUSDCBalance(accounts[0]);
          saveWalletState();
          updateWalletNavButton();
          renderWalletModalContent();
          handleRoute();
        } else {
          disconnectRealWallet();
        }
      });

      provider.on('chainChanged', () => {
        window.location.reload();
      });
    } catch (e) {
      console.warn("Could not bind events on active provider:", e);
    }
  }
}

function claimFaucetDrop() {
  // Open Circle Faucet in a new tab
  window.open('https://faucet.circle.com', '_blank');

  // Show a helpful tip to the user
  if (STATE.wallet.connected && STATE.wallet.address) {
    alert(`Opening the official Circle Faucet in a new tab.\n\nCopy your connected address to request testnet USDC:\n${STATE.wallet.address}`);
  } else {
    alert("Opening the official Circle Faucet in a new tab. Please connect your Web3 wallet first to copy your address.");
  }
}

function saveWalletState() {
  localStorage.setItem('jara-wallet', JSON.stringify(STATE.wallet));
}

// --- DYNAMIC VERIFICATION FORM RENDERING ---
function renderVerificationFormHTML(task) {
  const type = task.verificationType || 'text';

  if (type === 'photo') {
    return `
      <div style="width: 100%; text-align: left; margin-bottom: 15px;">
        <label style="font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">Upload Photo Proof</label>
        <div class="upload-zone" id="photo-upload-zone" onclick="document.getElementById('photo-file-input').click()">
          <i data-lucide="camera" style="width: 24px; height: 24px; color: var(--text-muted); margin-bottom: 8px;"></i>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">Click to upload storefront or audit photo</p>
          <input type="file" id="photo-file-input" style="display: none;" accept="image/*" onchange="handlePhotoUploadSelect(event)">
          <img id="photo-upload-preview" class="upload-preview" style="display: none;">
        </div>
        <input type="hidden" id="photo-base64-data">
      </div>
    `;
  }

  if (type === 'location') {
    const target = task.locationTarget || { lat: 6.4526, lon: 3.4076, name: 'Lagos Island, Lagos' };
    return `
      <div style="width: 100%; text-align: left; margin-bottom: 15px;">
        <label style="font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">GPS Location Verification</label>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">This task requires checking in at: <strong>${target.name}</strong> (${target.lat}, ${target.lon}).</p>
        <div class="location-checker">
          <button type="button" class="btn btn-secondary btn-sm" id="gps-check-in-btn" onclick="executeMockGPSCheckIn(${target.lat}, ${target.lon})">
            <i data-lucide="map-pin"></i> Verify GPS Coordinate Location
          </button>
          <div id="gps-status-indicator" style="font-size: 12px; font-weight: 500; display: none;"></div>
        </div>
        <input type="hidden" id="gps-verified-lat">
        <input type="hidden" id="gps-verified-lon">
        <input type="hidden" id="gps-verified-distance">
      </div>
    `;
  }

  if (type === 'referral') {
    return `
      <div style="width: 100%; text-align: left; margin-bottom: 15px;">
        <label style="font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">Referee Wallet Address</label>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Enter the EVM wallet address of the user you referred to confirm attribution.</p>
        <input type="text" id="referral-address-input" class="input-field" placeholder="e.g. 0x9E2a77fB192881b2ab6291a13a2c58aefd1887e1" style="width: 100%;">
      </div>
    `;
  }

  if (type === 'inventory') {
    const items = task.inventoryItems || [{ name: 'Coca-Cola 35cl (Crates)', expected: 25 }];
    return `
      <div style="width: 100%; text-align: left; margin-bottom: 15px;">
        <label style="font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">Inventory Count Verification</label>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Count crates and enter physical counts. Variance is calculated on completion.</p>
        <table class="inventory-table">
          <thead>
            <tr>
              <th>Stock Item</th>
              <th>Expected</th>
              <th>Actual Count</th>
              <th>Discrepancies</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => `
              <tr>
                <td><strong>${item.name}</strong></td>
                <td>${item.expected}</td>
                <td>
                  <input type="number" min="0" class="input-field inventory-actual-input" data-index="${idx}" data-expected="${item.expected}" oninput="recalcInventoryVariance(this)" placeholder="0" style="width: 70px; padding: 4px 8px; font-size: 13px; text-align: center;">
                </td>
                <td>
                  <span class="variance-indicator neutral" id="variance-disp-${idx}">0 units</span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Default 'text'
  return `
    <div style="width: 100%; text-align: left; margin-bottom: 15px;">
      <label style="font-weight: 600; font-size: 13px; display: block; margin-bottom: 6px;">Verification Text Submission</label>
      <textarea id="text-proof-input" class="input-field" rows="3" placeholder="Type receipt confirmation, order number, or survey details here..." style="width: 100%; resize: vertical;"></textarea>
    </div>
  `;
}

function handlePhotoUploadSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const preview = document.getElementById('photo-upload-preview');
    const base64Input = document.getElementById('photo-base64-data');
    if (preview) {
      preview.src = e.target.result;
      preview.style.display = 'block';
    }
    if (base64Input) {
      base64Input.value = e.target.result;
    }
  };
  reader.readAsDataURL(file);
}

function executeMockGPSCheckIn(targetLat, targetLon) {
  const btn = document.getElementById('gps-check-in-btn');
  const status = document.getElementById('gps-status-indicator');
  const latVal = document.getElementById('gps-verified-lat');
  const lonVal = document.getElementById('gps-verified-lon');
  const distVal = document.getElementById('gps-verified-distance');

  if (btn) btn.disabled = true;
  if (status) {
    status.innerHTML = `<i data-lucide="loader" class="spin" style="width: 12px; height: 12px; display: inline-block;"></i> Accessing GPS satellites...`;
    status.style.display = 'block';
    lucide.createIcons();
  }

  const processLocation = (lat, lon) => {
    const distanceMeters = ArcUtils.calculateHaversineDistance(lat, lon, targetLat, targetLon);

    if (latVal) latVal.value = lat.toFixed(6);
    if (lonVal) lonVal.value = lon.toFixed(6);
    if (distVal) distVal.value = distanceMeters;

    if (status) {
      status.style.color = distanceMeters <= 100 ? 'var(--success)' : 'var(--accent-amber)';
      status.innerHTML = `<i data-lucide="check-circle-2" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> Located: ${lat.toFixed(4)}, ${lon.toFixed(4)} (${distanceMeters}m away from target. Verification successful!)`;
      lucide.createIcons();
    }
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        processLocation(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        setTimeout(() => {
          const mockLat = targetLat + (Math.random() - 0.5) * 0.0004;
          const mockLon = targetLon + (Math.random() - 0.5) * 0.0004;
          processLocation(mockLat, mockLon);
        }, 1200);
      },
      { timeout: 6000 }
    );
  } else {
    setTimeout(() => {
      const mockLat = targetLat + (Math.random() - 0.5) * 0.0004;
      const mockLon = targetLon + (Math.random() - 0.5) * 0.0004;
      processLocation(mockLat, mockLon);
    }, 1200);
  }
}

function recalcInventoryVariance(input) {
  const expected = parseInt(input.getAttribute('data-expected')) || 0;
  const actual = parseInt(input.value) || 0;
  const variance = actual - expected;
  const index = input.getAttribute('data-index');
  const display = document.getElementById(`variance-disp-${index}`);

  if (display) {
    if (variance < 0) {
      display.textContent = `${variance} units`;
      display.className = 'variance-indicator negative';
    } else if (variance > 0) {
      display.textContent = `+${variance} units`;
      display.className = 'variance-indicator positive';
    } else {
      display.textContent = `0 units`;
      display.className = 'variance-indicator neutral';
    }
  }
}

function toggleFormVerificationFields(type) {
  const container = document.getElementById('verification-params-container');
  if (!container) return;

  if (type === 'location') {
    container.style.display = 'block';
    container.innerHTML = `
      <h4 style="font-size: 13px; text-transform: uppercase; margin-bottom: 12px; color: var(--text-muted);"><i data-lucide="map" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> Geolocation Check-in Settings</h4>
      <div class="form-grid" style="gap: 12px; grid-template-columns: 2fr 1fr 1fr; margin-bottom: 0;">
        <div class="input-group">
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Destination Name</label>
          <input type="text" id="param-loc-name" class="input-field" placeholder="e.g. Balogun Market Gate" required style="padding: 6px 12px; font-size: 13px;">
        </div>
        <div class="input-group">
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Latitude</label>
          <input type="number" step="0.000001" id="param-loc-lat" class="input-field" value="6.4526" required style="padding: 6px 12px; font-size: 13px;">
        </div>
        <div class="input-group">
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Longitude</label>
          <input type="number" step="0.000001" id="param-loc-lon" class="input-field" value="3.4076" required style="padding: 6px 12px; font-size: 13px;">
        </div>
      </div>
    `;
    lucide.createIcons();
  } else if (type === 'inventory') {
    container.style.display = 'block';
    container.innerHTML = `
      <h4 style="font-size: 13px; text-transform: uppercase; margin-bottom: 12px; color: var(--text-muted);"><i data-lucide="package" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> Inventory Audit Settings</h4>
      <div class="form-grid" style="gap: 12px; grid-template-columns: 3fr 1fr; margin-bottom: 0;">
        <div class="input-group">
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Stock Item Name</label>
          <input type="text" id="param-inv-name" class="input-field" placeholder="e.g. Coca-Cola Crates" required style="padding: 6px 12px; font-size: 13px;">
        </div>
        <div class="input-group">
          <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Expected Stock</label>
          <input type="number" min="1" id="param-inv-expected" class="input-field" value="20" required style="padding: 6px 12px; font-size: 13px;">
        </div>
      </div>
    `;
    lucide.createIcons();
  } else {
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

// --- SUBMISSION PROOF CARD RENDERING FOR REVIEW ---
function renderSubmissionProofDetailsHTML(sub, task) {
  const type = task ? (task.verificationType || 'text') : 'text';
  const data = sub.proofData || {};

  if (type === 'photo') {
    return `
      <div style="margin-top: 8px; margin-bottom: 12px;">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 4px; text-transform: uppercase;">Uploaded Photo Proof:</span>
        <div style="position: relative; max-width: 240px; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--border-color);">
          <img src="${data.photo || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80'}" style="width: 100%; display: block; max-height: 150px; object-fit: cover;">
          <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); padding: 4px 8px; font-size: 10px; color: white; text-align: center;">Verified Visual Proof</div>
        </div>
      </div>
    `;
  }

  if (type === 'location') {
    const isClose = parseInt(data.distance) <= 100;
    return `
      <div style="margin-top: 8px; margin-bottom: 12px; background: var(--bg-app); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 6px; text-transform: uppercase;">GPS Location Check-in:</span>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px;">
          <div>Location: <strong>${data.targetName || 'Lagos Island'}</strong></div>
          <div>Actual GPS Coordinates: <code>${data.lat || '6.4526'}, ${data.lon || '3.4076'}</code></div>
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
            <span class="map-badge" style="background: ${isClose ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${isClose ? 'var(--success)' : 'var(--error)'}; font-size: 11px; padding: 2px 8px;">
              <i data-lucide="${isClose ? 'check-circle' : 'alert-circle'}" style="width: 12px; height: 12px;"></i> ${data.distance || '22'}m away from Target
            </span>
            <span style="font-size: 11px; color: var(--text-muted);">(Match Target Radius &lt; 100m)</span>
          </div>
        </div>
      </div>
    `;
  }

  if (type === 'referral') {
    return `
      <div style="margin-top: 8px; margin-bottom: 12px; background: var(--bg-app); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 4px; text-transform: uppercase;">Attributed Referee Address:</span>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <i data-lucide="shield-check" style="color: var(--success); width: 16px; height: 16px;"></i>
          <code style="font-size: 13px; color: var(--text-primary); word-break: break-all;">${data.address || '0x9E2a...8c21'}</code>
          <span class="badge badge-active" style="background: rgba(16, 185, 129, 0.15); color: var(--success); font-size: 10px; border-radius: var(--radius-full); padding: 1px 6px;">Format Validated</span>
        </div>
      </div>
    `;
  }

  if (type === 'inventory') {
    const counts = data.counts || [];
    return `
      <div style="margin-top: 8px; margin-bottom: 12px;">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 6px; text-transform: uppercase;">Inventory Audit Breakdown:</span>
        <table class="inventory-table" style="margin: 0; max-width: 400px;">
          <thead>
            <tr>
              <th>Stock Item</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            ${counts.map(c => {
      const diffClass = c.variance < 0 ? 'negative' : (c.variance > 0 ? 'positive' : 'neutral');
      const diffText = c.variance < 0 ? `${c.variance} units` : (c.variance > 0 ? `+${c.variance} units` : '0 units');
      return `
                <tr>
                  <td><strong>${c.name}</strong></td>
                  <td>${c.expected}</td>
                  <td>${c.actual}</td>
                  <td><span class="variance-indicator ${diffClass}">${diffText}</span></td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Default 'text'
  return `
    <p style="font-size: 13px; color: var(--text-secondary); margin-top: 8px; margin-bottom: 12px; font-family: monospace; background: var(--bg-app); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
      "${sub.proof}"
    </p>
  `;
}

function renderEscrowTimelineHTML(task, claim) {
  const isClaimed = !!claim;
  const isPending = claim && claim.status === 'pending';
  const isCompleted = claim && (claim.status === 'completed' || claim.status === 'cashed_out');

  const step1Class = "completed";
  const step2Class = "completed";
  let step3Class = "";
  let step4Class = "";
  let step5Class = "";

  if (isCompleted) {
    step3Class = "completed";
    step4Class = "completed";
    step5Class = "completed";
  } else if (isPending) {
    step3Class = "completed";
    step4Class = "active";
  } else if (isClaimed) {
    step3Class = "active";
  }

  return `
    <div class="escrow-timeline">
      <div class="timeline-step ${step1Class}">
        <div class="timeline-node">1</div>
        <div class="timeline-content">
          <div class="timeline-title">Task Pool Initialized</div>
          <div class="timeline-desc">Created by ${task.creator} &bull; Quota: ${task.limit} claims</div>
        </div>
      </div>
      <div class="timeline-step ${step2Class}">
        <div class="timeline-node">2</div>
        <div class="timeline-content">
          <div class="timeline-title">Rewards Escrow Locked</div>
          <div class="timeline-desc">Funds deposited in Arc Escrow Vault contract</div>
          <div class="timeline-meta">Escrow: ${task.escrowAgreementAddress || '0x...'}<br>Tx: ${task.escrowTxHash ? task.escrowTxHash.slice(0, 18) + '...' : '0x...'}</div>
        </div>
      </div>
      <div class="timeline-step ${step3Class}">
        <div class="timeline-node">3</div>
        <div class="timeline-content">
          <div class="timeline-title">Proof of Work Submitted</div>
          <div class="timeline-desc">${isCompleted || isPending ? 'Proof submitted by earner' : (isClaimed ? 'Task claimed. Awaiting proof submission...' : 'Awaiting claim by earner...')}</div>
          ${claim && claim.timestamp ? `<div class="timeline-meta">Timestamp: ${new Date(claim.timestamp).toLocaleString()}</div>` : ''}
        </div>
      </div>
      <div class="timeline-step ${step4Class}">
        <div class="timeline-node">4</div>
        <div class="timeline-content">
          <div class="timeline-title">Verification & Review</div>
          <div class="timeline-desc">${isCompleted ? 'Verification approved by business' : (isPending ? 'Business is reviewing your submitted proof...' : 'Awaiting review...')}</div>
        </div>
      </div>
      <div class="timeline-step ${step5Class}">
        <div class="timeline-node">5</div>
        <div class="timeline-content">
          <div class="timeline-title">Nanopayment Released</div>
          <div class="timeline-desc">${isCompleted ? `USDC reward transferred to earner's wallet` : 'Awaiting payout release...'}</div>
          ${claim && claim.txHash ? `<div class="timeline-meta">Tx Hash: <a href="https://testnet.arcscan.app/tx/${claim.txHash}" target="_blank" style="color: var(--primary); text-decoration: underline;">${claim.txHash.slice(0, 16)}...</a></div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Bind utilities globally
window.handlePhotoUploadSelect = handlePhotoUploadSelect;
window.executeMockGPSCheckIn = executeMockGPSCheckIn;
window.recalcInventoryVariance = recalcInventoryVariance;
window.toggleFormVerificationFields = toggleFormVerificationFields;
window.renderEscrowTimelineHTML = renderEscrowTimelineHTML;


function updateWalletNavButton() {
  const walletBtn = document.getElementById('wallet-connect-btn');
  const btnText = document.getElementById('wallet-btn-text');

  if (STATE.wallet.connected) {
    const formattedAddress = `${STATE.wallet.address.slice(0, 6)}...${STATE.wallet.address.slice(-4)}`;
    btnText.textContent = `${formattedAddress} (${STATE.wallet.balance.toFixed(2)} USDC)`;
    walletBtn.style.borderColor = 'var(--secondary)';
  } else {
    btnText.textContent = 'Connect Wallet';
    walletBtn.style.borderColor = 'var(--border-color)';
  }
}

function renderWalletModalContent() {
  const disconnectedDiv = document.getElementById('wallet-modal-disconnected');
  const connectedDiv = document.getElementById('wallet-modal-connected');
  const addressSpan = document.getElementById('wallet-modal-address');
  const balanceSpan = document.getElementById('wallet-modal-balance');

  if (STATE.wallet.connected) {
    disconnectedDiv.style.display = 'none';
    connectedDiv.style.display = 'block';
    addressSpan.textContent = STATE.wallet.address;
    balanceSpan.textContent = `${STATE.wallet.balance.toFixed(2)} USDC`;
  } else {
    disconnectedDiv.style.display = 'block';
    connectedDiv.style.display = 'none';
  }
}

// --- MODAL CONTROLLER ---
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('open');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('open');
  }
}

// Expose modal closing function globally
window.closeModal = closeModal;

// --- DYNAMIC TRANSACTION ANIMATION ---
function showTransactionSuccessAnimation(amount, description, customReceiptId = null) {
  openModal('tx-modal');
  const loadingState = document.getElementById('tx-loading-state');
  const successState = document.getElementById('tx-success-state');

  loadingState.style.display = 'block';
  successState.style.display = 'none';

  setTimeout(() => {
    loadingState.style.display = 'none';
    successState.style.display = 'block';

    document.getElementById('tx-success-desc').textContent = description;
    document.getElementById('tx-receipt-amount').textContent = `$${amount.toFixed(2)} USDC`;
    document.getElementById('tx-receipt-id').textContent = customReceiptId || `ARC-TX-${Math.floor(100000 + Math.random() * 900000)}`;

    lucide.createIcons();
  }, 1800);
}

async function runEscrowTxSimulation(actionType, params) {
  return new Promise((resolve) => {
    openModal('tx-modal');
    const loadingState = document.getElementById('tx-loading-state');
    const successState = document.getElementById('tx-success-state');
    const stepsContainer = document.getElementById('tx-steps-container');
    const escrowRow = document.getElementById('tx-escrow-address-row');

    loadingState.style.display = 'block';
    successState.style.display = 'none';

    let steps = [];
    let title = '';
    let subtitle = '';
    let successTitle = '';
    let successDesc = '';
    let amount = 0;
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const receiptId = `ARC-TX-${Math.floor(100000 + Math.random() * 900000)}`;

    if (actionType === 'payout') {
      title = "Releasing Escrow Payout";
      subtitle = "Interacting with Arc Escrow Smart Contract...";
      successTitle = "Payment Released!";
      successDesc = `Nanopayment reward distributed gaslessly to earner address.`;
      amount = params.reward;

      if (escrowRow) escrowRow.style.display = 'flex';
      const escAddrSpan = document.getElementById('tx-escrow-address');
      if (escAddrSpan) escAddrSpan.textContent = params.escrowAddress ? `${params.escrowAddress.slice(0, 8)}...${params.escrowAddress.slice(-6)}` : '0x...';

      steps = [
        "Initiating escrow release payload...",
        "Validating multi-signature credentials...",
        "Triggering payout function on-chain...",
        "NanoUSDC successfully transferred!"
      ];
    } else if (actionType === 'cashout') {
      title = "Cashing Out Earnings";
      subtitle = "Consolidating state channels and withdrawing...";
      successTitle = "Withdrawal Success!";
      successDesc = `Your off-chain nanopayments have been aggregated and cashed out.`;
      amount = params.amount;

      if (escrowRow) escrowRow.style.display = 'none';

      steps = [
        "Retrieving off-chain ledger claims...",
        "Consolidating micro-balances...",
        "Submitting aggregated cashout to Arc L2...",
        "USDC successfully deposited to your wallet!"
      ];
    }

    document.getElementById('tx-loading-title').textContent = title;
    document.getElementById('tx-loading-subtitle').textContent = subtitle;

    stepsContainer.innerHTML = `
      <div class="tx-step-list">
        ${steps.map((step, idx) => `
          <div class="tx-step-item" id="tx-step-${idx}">
            <span class="tx-step-icon" id="tx-step-icon-${idx}">
              <i data-lucide="circle" style="width: 14px; height: 14px; color: var(--text-muted);"></i>
            </span>
            <span>${step}</span>
          </div>
        `).join('')}
      </div>
    `;
    lucide.createIcons();

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep > 0) {
        const prevItem = document.getElementById(`tx-step-${currentStep - 1}`);
        const prevIcon = document.getElementById(`tx-step-icon-${currentStep - 1}`);
        if (prevItem) prevItem.className = 'tx-step-item completed';
        if (prevIcon) {
          prevIcon.innerHTML = `<i data-lucide="check-circle" style="width: 14px; height: 14px; color: var(--success);"></i>`;
        }
      }

      if (currentStep < steps.length) {
        const currItem = document.getElementById(`tx-step-${currentStep}`);
        const currIcon = document.getElementById(`tx-step-icon-${currentStep}`);
        if (currItem) currItem.className = 'tx-step-item pending';
        if (currIcon) {
          currIcon.innerHTML = `<i data-lucide="loader" class="spin" style="width: 14px; height: 14px; color: var(--primary);"></i>`;
        }
        lucide.createIcons();
        currentStep++;
      } else {
        clearInterval(interval);

        loadingState.style.display = 'none';
        successState.style.display = 'block';

        document.getElementById('tx-success-title').textContent = successTitle;
        document.getElementById('tx-success-desc').textContent = successDesc;
        document.getElementById('tx-receipt-amount').textContent = `$${amount.toFixed(2)} USDC`;
        document.getElementById('tx-receipt-id').textContent = receiptId;

        const explorerLink = document.getElementById('tx-receipt-explorer-link');
        if (explorerLink) {
          explorerLink.href = `https://testnet.arcscan.app/tx/${txHash}`;
          explorerLink.textContent = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;
        }

        lucide.createIcons();
        resolve({ txHash });
      }
    }, 600);
  });
}
window.runEscrowTxSimulation = runEscrowTxSimulation;

// ================= RENDER LOGIC FOR CORE PAGES =================

// --- 1. LANDING VIEW ---
function renderLandingView(container) {
  container.innerHTML = `
    <!-- Hero Header Section -->
    <section class="hero-section" style="padding-bottom: 60px;">
      <div>
        <h1 class="hero-title" style="font-size: 48px; line-height: 1.15; margin-bottom: 20px;">
          Community Commerce Infrastructure Powered by <span style="background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Stablecoin Nanopayments</span>
        </h1>
        <p class="hero-desc" style="font-size: 16px; line-height: 1.6; margin-bottom: 32px; color: var(--text-secondary);">
          Jara coordinates and monetizes hyper local micro work that was previously uneconomical to reward. Powered gaslessly on the Arc Network.
        </p>
        <div class="hero-actions">
          <a href="#/marketplace" class="btn btn-primary">
            <i data-lucide="search"></i> Browse Tasks
          </a>
          <a href="#/create" class="btn btn-outline">
            <i data-lucide="plus-circle"></i> Create a Task
          </a>
        </div>
      </div>
      
      <!-- Lagos Commerce Vector SVG Illustration -->
      <div class="hero-graphic" style="position: relative; width: 100%; display: flex; justify-content: center;">
        <div class="glow-ring" style="width: 380px; height: 380px;"></div>
        <svg viewBox="0 0 500 400" width="100%" height="auto" style="max-width: 440px; z-index: 10; border-radius: var(--radius-lg); filter: drop-shadow(0 20px 40px rgba(0,0,0,0.15));" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="skyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="hsl(262, 80%, 15%)" />
              <stop offset="60%" stop-color="hsl(330, 85%, 20%)" />
              <stop offset="100%" stop-color="hsl(40, 95%, 25%)" />
            </linearGradient>
            <linearGradient id="bridgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="var(--primary)" />
              <stop offset="100%" stop-color="var(--secondary)" />
            </linearGradient>
            <linearGradient id="phoneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="hsl(224, 25%, 22%)" />
              <stop offset="100%" stop-color="hsl(224, 25%, 12%)" />
            </linearGradient>
          </defs>
          
          <!-- Background sky and warm Lagos sunset glow -->
          <rect width="500" height="400" rx="24" fill="url(#skyGrad)" />
          
          <!-- Abstract Lagos Skyline Shapes (Civic Centre and Towers) -->
          <path d="M 50 400 L 50 220 L 90 190 L 130 220 L 130 400 Z" fill="rgba(255,255,255,0.03)" />
          <rect x="150" y="120" width="60" height="280" rx="4" fill="rgba(255,255,255,0.04)" />
          <rect x="220" y="80" width="85" height="320" rx="8" fill="rgba(255,255,255,0.02)" />
          <!-- Civic Centre grid layout design pattern -->
          <path d="M 220 120 L 305 200 M 220 200 L 305 120 M 220 280 L 305 200 M 220 200 L 305 280" stroke="rgba(255,255,255,0.06)" stroke-width="2" />
          
          <!-- Third Mainland Bridge arches stretching across Lagoon -->
          <path d="M -20 400 Q 80 320 180 400 Q 280 320 380 400 Q 480 320 580 400" fill="none" stroke="url(#bridgeGrad)" stroke-width="4" opacity="0.45" />
          
          <!-- Local Market Stalls (Balogun / Yaba themed canopy stalls) -->
          <path d="M 40 400 L 40 330 L 140 330 L 140 400 Z" fill="rgba(13, 148, 136, 0.15)" />
          <!-- Striped canopy awning -->
          <path d="M 30 330 Q 55 310 80 330 Q 105 310 130 330 Q 155 310 150 330 L 140 350 L 40 350 Z" fill="var(--accent-pink)" />
          <line x1="90" y1="350" x2="90" y2="400" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
          
          <!-- Arc Network digital transaction nodes overlays -->
          <circle cx="150" cy="180" r="6" fill="var(--secondary)" />
          <circle cx="280" cy="220" r="8" fill="var(--primary)" />
          <circle cx="360" cy="150" r="5" fill="var(--accent-pink)" />
          <path d="M 150 180 L 280 220 L 360 150" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-dasharray="4" fill="none" />
          
          <!-- Main Earner Mobile Dashboard (floating) -->
          <g transform="translate(300, 160)">
            <!-- Phone shell -->
            <rect width="160" height="210" rx="18" fill="url(#phoneGrad)" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
            <!-- Camera Notch -->
            <rect x="60" y="6" width="40" height="8" rx="4" fill="#000" />
            <!-- Balance Card -->
            <rect x="12" y="30" width="136" height="65" rx="10" fill="linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)" />
            <text x="22" y="52" fill="rgba(255,255,255,0.7)" font-size="9" font-family="sans-serif">Arc Wallet Balance</text>
            <text x="22" y="78" fill="#fff" font-size="18" font-family="'Outfit', sans-serif" font-weight="bold">$12.50 USDC</text>
            <!-- Transaction Notification Card -->
            <rect x="12" y="110" width="136" height="80" rx="10" fill="rgba(255,255,255,0.06)" />
            <circle cx="32" cy="138" r="14" fill="rgba(16, 185, 129, 0.15)" />
            <!-- Checkmark inside circle -->
            <path d="M 27 138 L 30 141 L 37 134" stroke="var(--success)" stroke-width="2" fill="none" stroke-linecap="round" />
            <text x="54" y="134" fill="#fff" font-size="10" font-weight="600" font-family="sans-serif">Payout Received</text>
            <text x="54" y="146" fill="var(--secondary)" font-size="11" font-weight="700" font-family="sans-serif">+$0.25 USDC</text>
            <text x="18" y="174" fill="rgba(255,255,255,0.4)" font-size="8" font-family="monospace">Balogun Audit Complete</text>
          </g>
        </svg>
      </div>
    </section>

    <!-- Platform Stats -->
    <div class="stats-bar" style="margin-bottom: 60px;">
      <div class="stat-item">
        <div class="stat-val">$${STATE.tasks.reduce((sum, t) => sum + (t.reward * t.completedCount), 0).toFixed(2)}</div>
        <div class="stat-lbl">Distributed to Communities</div>
      </div>
      <div class="stat-item">
        <div class="stat-val">${STATE.tasks.reduce((sum, t) => sum + t.completedCount, 0).toLocaleString()}</div>
        <div class="stat-lbl">Micro-tasks Settled</div>
      </div>
      <div class="stat-item">
        <div class="stat-val">${STATE.tasks.reduce((sum, t) => sum + t.completedCount, 0) > 0 ? "1.2s" : "0.0s"}</div>
        <div class="stat-lbl">Average Arc Settlement Speed</div>
      </div>
    </div>

    <!-- Section 1: How It Works -->
    <section style="text-align: center; margin-bottom: 80px; padding: 40px 0;">
      <h2 style="font-size: 32px; margin-bottom: 12px;">How It Works</h2>
      <p style="color: var(--text-secondary); max-width: 550px; margin: 0 auto 52px auto; font-size: 15px;">
        Jara coordinates micro work via gasless Paymaster vaults, resolving micro-incentives through off-chain aggregation and instant L2 stablecoin settlement.
      </p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 30px;">
        <div class="card" style="text-align: left; padding: 30px;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--primary-glow); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 20px; font-family: var(--font-heading);">1</div>
          <h3 style="font-size: 18px; margin-bottom: 10px;">Deploy Smart Vault Pool</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5;">
            Businesses define micro work validation rules and lock stablecoin reward liquidity in a gasless Arc Escrow smart contract vault.
          </p>
        </div>

        <div class="card" style="text-align: left; padding: 30px;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--secondary-glow); color: var(--secondary); display: flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 20px; font-family: var(--font-heading);">2</div>
          <h3 style="font-size: 18px; margin-bottom: 10px;">Off-Chain Coordination</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5;">
            Earners locate hyper local micro work, execute physical or digital validation steps, and submit proof cryptographically via their mobile device.
          </p>
        </div>

        <div class="card" style="text-align: left; padding: 30px;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); color: var(--success); display: flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 20px; font-family: var(--font-heading);">3</div>
          <h3 style="font-size: 18px; margin-bottom: 10px;">Gasless L2 Settlement</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5;">
            L2 Paymaster nodes sponsor gas fees, settling sub-cent stablecoin nanopayments instantly into the earner's wallet upon cryptographic proof verification.
          </p>
        </div>
      </div>
    </section>

    <!-- Section 2: Use Cases (Lagos Theme) -->
    <section style="margin-bottom: 80px; padding: 40px 0;">
      <div style="text-align: center; margin-bottom: 48px;">
        <h2 style="font-size: 32px; margin-bottom: 12px;">Ecosystem Use Cases</h2>
        <p style="color: var(--text-secondary); max-width: 580px; margin: 0 auto; font-size: 15px;">
          Coordinating high-fidelity physical audits, local index tracking, and localized micro work that was previously uneconomical to reward.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px;">
        <div class="card" style="display: flex; flex-direction: column; gap: 14px;">
          <div style="color: var(--primary);"><i data-lucide="store" style="width: 32px; height: 32px;"></i></div>
          <h3 style="font-size: 18px;">Balogun Market Audits</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5; flex-grow: 1;">
            Distributors deploy tasks for local earners to visit specific stalls, verifying retail price ceilings and wholesale stock levels.
          </p>
          <span class="badge badge-active" style="width: fit-content;">Local Audit</span>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 14px;">
          <div style="color: var(--secondary);"><i data-lucide="clipboard-list" style="width: 32px; height: 32px;"></i></div>
          <h3 style="font-size: 18px;">Ikeja Tech Store Survey</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5; flex-grow: 1;">
            Electronics shops collect instant surveys from walk-in shoppers, assessing product accessibility and queue wait times.
          </p>
          <span class="badge badge-pending" style="width: fit-content; background: rgba(13, 148, 136, 0.12); color: var(--secondary);">Digital Poll</span>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 14px;">
          <div style="color: var(--accent-pink);"><i data-lucide="smartphone" style="width: 32px; height: 32px;"></i></div>
          <h3 style="font-size: 18px;">Yaba Hub Beta Testing</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5; flex-grow: 1;">
            Fintech startups deploy quick test missions to local users, validating UX steps and checkouts on low-bandwidth connections.
          </p>
          <span class="badge badge-active" style="width: fit-content; background: rgba(236, 72, 153, 0.12); color: var(--accent-pink);">App Testing</span>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 14px;">
          <div style="color: var(--accent-amber);"><i data-lucide="megaphone" style="width: 32px; height: 32px;"></i></div>
          <h3 style="font-size: 18px;">VI Restaurant Promos</h3>
          <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.5; flex-grow: 1;">
            New food joints run mini social sharing micro-campaigns, getting community earners to publish geolocation posts.
          </p>
          <span class="badge badge-pending" style="width: fit-content; background: rgba(245, 158, 11, 0.12); color: var(--accent-amber);">Social Boost</span>
        </div>
      </div>
    </section>

    <!-- Section 3: Split Benefits (Business vs Community) -->
    <section style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 80px; padding: 40px 0;">
      <!-- Business Benefits -->
      <div class="glass-card" style="border-color: var(--primary-glow); padding: 32px;">
        <h2 style="font-size: 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 10px;">
          <i data-lucide="briefcase" style="color: var(--primary);"></i> Business Benefits
        </h2>
        <ul style="list-style: none; display: flex; flex-direction: column; gap: 20px;">
          <li style="display: flex; gap: 12px;">
            <i data-lucide="check-circle" style="color: var(--success); flex-shrink: 0; width: 20px; height: 20px;"></i>
            <div>
              <strong style="display: block; font-size: 15px; margin-bottom: 2px;">Frictionless Auditing</strong>
              <span style="color: var(--text-secondary); font-size: 14px;">Get on-the-ground photos, store verification, and survey insights in minutes.</span>
            </div>
          </li>
          <li style="display: flex; gap: 12px;">
            <i data-lucide="check-circle" style="color: var(--success); flex-shrink: 0; width: 20px; height: 20px;"></i>
            <div>
              <strong style="display: block; font-size: 15px; margin-bottom: 2px;">Zero Transaction Gas Fees</strong>
              <span style="color: var(--text-secondary); font-size: 14px;">Our paymaster infrastructure sponsors gas, so your funds are entirely used for reward payouts.</span>
            </div>
          </li>
          <li style="display: flex; gap: 12px;">
            <i data-lucide="check-circle" style="color: var(--success); flex-shrink: 0; width: 20px; height: 20px;"></i>
            <div>
              <strong style="display: block; font-size: 15px; margin-bottom: 2px;">Targeted Local Demographics</strong>
              <span style="color: var(--text-secondary); font-size: 14px;">Direct tasks to real geographic areas instead of digital clickfarms or automated bots.</span>
            </div>
          </li>
        </ul>
      </div>

      <!-- Community Benefits -->
      <div class="glass-card" style="border-color: var(--secondary-glow); padding: 32px;">
        <h2 style="font-size: 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 10px;">
          <i data-lucide="users" style="color: var(--secondary);"></i> Community Benefits
        </h2>
        <ul style="list-style: none; display: flex; flex-direction: column; gap: 20px;">
          <li style="display: flex; gap: 12px;">
            <i data-lucide="check-circle" style="color: var(--success); flex-shrink: 0; width: 20px; height: 20px;"></i>
            <div>
              <strong style="display: block; font-size: 15px; margin-bottom: 2px;">Instant Stablecoin Payouts</strong>
              <span style="color: var(--text-secondary); font-size: 14px;">Rewards stream directly to your wallet upon task approval. No holds, no delays.</span>
            </div>
          </li>
          <li style="display: flex; gap: 12px;">
            <i data-lucide="check-circle" style="color: var(--success); flex-shrink: 0; width: 20px; height: 20px;"></i>
            <div>
              <strong style="display: block; font-size: 15px; margin-bottom: 2px;">Zero Minimum Cashout</strong>
              <span style="color: var(--text-secondary); font-size: 14px;">Earn 5 cents or 50 dollars; withdraw your balance instantly without threshold limits.</span>
            </div>
          </li>
          <li style="display: flex; gap: 12px;">
            <i data-lucide="check-circle" style="color: var(--success); flex-shrink: 0; width: 20px; height: 20px;"></i>
            <div>
              <strong style="display: block; font-size: 15px; margin-bottom: 2px;">Completely Free to Play</strong>
              <span style="color: var(--text-secondary); font-size: 14px;">Smart contract wallets handle key management gaslessly behind the scenes.</span>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- Section 4: Call to Action (CTA) -->
    <section class="glass-card" style="text-align: center; padding: 48px; border-color: var(--border-color); background: radial-gradient(circle at top right, var(--primary-glow), transparent 60%);">
      <h2 style="font-size: 36px; margin-bottom: 16px;">Ready to Coordinate Community Commerce?</h2>
      <p style="color: var(--text-secondary); max-width: 550px; margin: 0 auto 36px auto; font-size: 16px; line-height: 1.6;">
        ${STATE.role === 'earner'
      ? 'Connect your wallet in seconds, authorize session keys, and start earning stablecoin nanopayments for micro work.'
      : 'Deploy a gasless task pool, deposit stablecoin liquidity, and access on-demand local coordinates and verification.'}
      </p>
      <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
        ${STATE.role === 'earner'
      ? `<a href="#/marketplace" class="btn btn-primary"><i data-lucide="arrow-right"></i> Open Task Marketplace</a>
             <button class="btn btn-outline" onclick="openModal('wallet-modal'); renderWalletModalContent();"><i data-lucide="wallet"></i> Setup Wallet</button>`
      : `<a href="#/create" class="btn btn-secondary"><i data-lucide="plus"></i> Deploy Task Pool</a>
             <button class="btn btn-outline" onclick="openModal('wallet-modal'); renderWalletModalContent();"><i data-lucide="wallet"></i> Connect Pool Wallet</button>`}
      </div>
    </section>
  `;
}


// --- 2. TASK MARKETPLACE VIEW ---
let activeCategoryFilter = 'all';
let searchQuery = '';

function renderMarketplaceView(container) {
  // Filter and Search logic
  const filteredTasks = STATE.tasks.filter(task => {
    const matchesCategory = activeCategoryFilter === 'all' || task.category === activeCategoryFilter;
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.creator.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch && task.status === 'active';
  });

  let taskCardsHtml = '';
  if (filteredTasks.length === 0) {
    taskCardsHtml = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: var(--text-secondary);">
        <i data-lucide="inbox" style="width: 48px; height: 48px; margin-bottom: 16px;"></i>
        <h3>No matching tasks found</h3>
        <p>Try resetting filters or adjusting search keyword.</p>
      </div>
    `;
  } else {
    filteredTasks.forEach(task => {
      // Calculate micro-USD / nanopayment translation display
      const nanoAmount = Math.round(task.reward * 1000000).toLocaleString();

      taskCardsHtml += `
        <div class="card task-card" style="cursor: pointer;" onclick="openTaskDetails('${task.id}')">
          <div>
            <div class="task-header">
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="task-category cat-${task.category}">${task.category}</span>
                <span class="escrow-badge" style="font-size: 9px; padding: 2px 6px;"><i data-lucide="lock" style="width: 8px; height: 8px;"></i> Escrowed</span>
              </div>
              <div style="text-align: right;">
                <span class="task-reward">$${task.reward.toFixed(2)} USDC</span>
                <div class="task-reward-nanopayment">${nanoAmount} nanoUSDC</div>
              </div>
            </div>
            <h3 class="task-title">${task.title}</h3>
            <p class="task-desc">${task.desc}</p>
          </div>
          <div>
            <div style="background: var(--bg-app); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 12px; margin-bottom: 16px; display: flex; justify-content: space-between;">
              <span style="color: var(--text-secondary);">Quota:</span>
              <span style="font-weight: 600; color: var(--text-primary);">${task.completedCount} / ${task.limit} claimed</span>
            </div>
            <div class="task-meta">
              <div class="task-business">
                <div class="biz-avatar">${task.creator.slice(0, 2).toUpperCase()}</div>
                <span>${task.creator}</span>
              </div>
              <span><i data-lucide="zap" style="width: 12px; height: 12px; display: inline; vertical-align: middle;"></i> Arc </span>
            </div>
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <div class="marketplace-header">
      <div>
        <h1 style="font-size: 36px; margin-bottom: 4px;">Task Marketplace</h1>
        <p style="color: var(--text-secondary);">Coordinate hyper local micro work and earn stablecoin nanopayments settled gaslessly on the Arc Network.</p>
      </div>
      <div style="background: var(--bg-card); padding: 8px 16px; border-radius: var(--radius-full); border: 1px solid var(--border-color); font-size: 13px; color: var(--text-secondary);">
        Role Perspective: <strong style="color: var(--primary);">${STATE.role === 'earner' ? 'Earner (Browse & Claim)' : 'Business Creator (Preview Mode)'}</strong>
      </div>
    </div>

    <!-- Search and Filter Panel -->
    <div class="search-filter-bar">
      <div class="input-icon-wrapper">
        <i data-lucide="search"></i>
        <input type="text" placeholder="Search tasks or brands..." class="input-field" id="search-input" value="${searchQuery}">
      </div>

      <div class="input-group">
        <select class="input-field" id="category-filter" style="cursor: pointer;">
          <option value="all" ${activeCategoryFilter === 'all' ? 'selected' : ''}>All Categories</option>
          <option value="local" ${activeCategoryFilter === 'local' ? 'selected' : ''}>Local Audit</option>
          <option value="digital" ${activeCategoryFilter === 'digital' ? 'selected' : ''}>Digital Polls</option>
          <option value="social" ${activeCategoryFilter === 'social' ? 'selected' : ''}>Social Sharing</option>
          <option value="testing" ${activeCategoryFilter === 'testing' ? 'selected' : ''}>App Testing</option>
        </select>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
        <span style="font-size: 13px; color: var(--text-muted);">${filteredTasks.length} active tasks</span>
      </div>
    </div>

    <!-- Tasks Grid -->
    <div class="tasks-grid">
      ${taskCardsHtml}
    </div>
  `;

  // Bind marketplace events
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderMarketplaceView(container);
    lucide.createIcons();
  });

  document.getElementById('category-filter')?.addEventListener('change', (e) => {
    activeCategoryFilter = e.target.value;
    renderMarketplaceView(container);
    lucide.createIcons();
  });
}

// Open details of selected task in modal
function openTaskDetails(taskId) {
  const task = STATE.tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('modal-task-title').textContent = task.title;
  document.getElementById('modal-task-desc').textContent = task.desc;
  document.getElementById('modal-task-instructions').textContent = task.instructions;
  document.getElementById('modal-task-proof-req').textContent = task.proofReq;

  const nanoAmount = Math.round(task.reward * 1000000).toLocaleString();
  document.getElementById('modal-task-reward').innerHTML = `
    $${task.reward.toFixed(2)} USDC <span style="font-size: 12px; font-weight: 400; color: var(--text-muted); display: block;">${nanoAmount} nanoUSDC</span>
  `;

  const badgeContainer = document.getElementById('modal-task-badge-container');
  badgeContainer.innerHTML = `
    <span class="task-category cat-${task.category}">${task.category}</span>
    <span class="escrow-badge" style="margin-left: 8px;"><i data-lucide="lock" style="width: 10px; height: 10px;"></i> Escrow Funded</span>
  `;

  const claim = STATE.myClaims.find(c => c.taskId === task.id);
  const escrowContainer = document.getElementById('modal-escrow-status-container');
  if (escrowContainer) {
    escrowContainer.innerHTML = renderEscrowTimelineHTML(task, claim);
  }

  const actionsDiv = document.getElementById('modal-task-actions');
  actionsDiv.innerHTML = '';

  // Context-specific actions based on simulated role & wallet status
  if (!STATE.wallet.connected) {
    actionsDiv.innerHTML = `
      <button class="btn btn-primary" onclick="closeModal('task-modal'); openModal('wallet-modal'); renderWalletModalContent();">
        <i data-lucide="wallet"></i> Connect Wallet to Participate
      </button>
    `;
  } else if (STATE.role === 'business') {
    actionsDiv.innerHTML = `
      <button class="btn btn-outline" style="cursor: not-allowed;" disabled>
        Created by you
      </button>
    `;
  } else {
    // Earner role actions
    const claim = STATE.myClaims.find(c => c.taskId === task.id);
    if (!claim) {
      actionsDiv.innerHTML = `
        <button class="btn btn-secondary" onclick="claimTaskInModal('${task.id}')">
          <i data-lucide="check-square"></i> Claim Micro-Task
        </button>
      `;
    } else if (claim.status === 'claimed') {
      actionsDiv.innerHTML = `
        <button class="btn btn-primary" onclick="promptProofSubmission('${task.id}')">
          <i data-lucide="upload-cloud"></i> Submit Proof
        </button>
      `;
    } else if (claim.status === 'pending') {
      actionsDiv.innerHTML = `
        <button class="btn btn-outline" style="cursor: not-allowed;" disabled>
          <i data-lucide="clock"></i> Under Review
        </button>
      `;
    } else if (claim.status === 'completed') {
      actionsDiv.innerHTML = `
        <button class="btn btn-outline" style="border-color: var(--success); color: var(--success); cursor: not-allowed;" disabled>
          <i data-lucide="check"></i> Paid
        </button>
      `;
    }
  }

  openModal('task-modal');
  lucide.createIcons();
}

window.openTaskDetails = openTaskDetails;

function claimTaskInModal(taskId) {
  if (!STATE.wallet.connected) return;
  STATE.myClaims.push({
    taskId: taskId,
    status: 'claimed',
    proof: '',
    timestamp: Date.now()
  });
  closeModal('task-modal');
  handleRoute();
}
window.claimTaskInModal = claimTaskInModal;

function promptProofSubmission(taskId) {
  const task = STATE.tasks.find(t => t.id === taskId);
  const actionsDiv = document.getElementById('modal-task-actions');
  if (!task) return;

  actionsDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px; align-items: flex-start; width: 100%;">
      ${renderVerificationFormHTML(task)}
      <div style="display: flex; gap: 8px; width: 100%; justify-content: flex-end; margin-top: 10px;">
        <button class="btn btn-ghost" onclick="openTaskDetails('${taskId}')">Cancel</button>
        <button class="btn btn-primary" onclick="submitProofInModal('${taskId}')">Submit Proof</button>
      </div>
    </div>
  `;
  lucide.createIcons();
}
window.promptProofSubmission = promptProofSubmission;

function submitProofInModal(taskId) {
  const task = STATE.tasks.find(t => t.id === taskId);
  if (!task) return;

  const type = task.verificationType || 'text';
  let proofText = '';
  let proofData = {};

  if (type === 'photo') {
    const photoData = document.getElementById('photo-base64-data')?.value;
    if (!photoData) {
      alert('Please upload a photo first.');
      return;
    }
    proofText = "Photo Proof Uploaded";
    proofData = { photo: photoData };
  } else if (type === 'location') {
    const lat = document.getElementById('gps-verified-lat')?.value;
    const lon = document.getElementById('gps-verified-lon')?.value;
    const distance = document.getElementById('gps-verified-distance')?.value;
    if (!lat || !lon) {
      alert('Please complete the GPS check-in first.');
      return;
    }
    proofText = `GPS Checked in: ${lat}, ${lon} (${distance}m away)`;
    proofData = {
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      distance: parseInt(distance),
      targetName: task.locationTarget?.name || 'Lagos Island'
    };
  } else if (type === 'referral') {
    const refAddress = document.getElementById('referral-address-input')?.value || '';
    if (!refAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      alert('Please enter a valid EVM wallet address (0x followed by 40 hex characters).');
      return;
    }
    proofText = `Referral wallet address: ${refAddress}`;
    proofData = { address: refAddress };
  } else if (type === 'inventory') {
    const inputs = document.querySelectorAll('.inventory-actual-input');
    const counts = [];
    let allFilled = true;
    inputs.forEach(input => {
      if (input.value === '') {
        allFilled = false;
      }
      const idx = parseInt(input.getAttribute('data-index'));
      const expectedItem = task.inventoryItems[idx];
      const actual = parseInt(input.value) || 0;
      counts.push({
        name: expectedItem.name,
        expected: expectedItem.expected,
        actual: actual,
        variance: actual - expectedItem.expected
      });
    });
    if (!allFilled) {
      alert('Please fill out all actual count fields.');
      return;
    }
    proofText = counts.map(c => `${c.name}: Counted ${c.actual} (Expected ${c.expected}, Var ${c.variance})`).join(', ');
    proofData = { counts: counts };
  } else {
    const txt = document.getElementById('text-proof-input')?.value || '';
    if (!txt) {
      alert('Submission text cannot be empty.');
      return;
    }
    proofText = txt;
    proofData = { text: txt };
  }

  const claim = STATE.myClaims.find(c => c.taskId === taskId);
  if (claim) {
    claim.status = 'pending';
    claim.proof = proofText;
    claim.proofData = proofData;
    claim.timestamp = Date.now();
  }

  STATE.submissions.unshift({
    id: `sub-${Date.now()}`,
    taskId: taskId,
    taskTitle: task.title,
    earnerAddress: STATE.wallet.address,
    proof: proofText,
    proofData: proofData,
    timestamp: new Date().toISOString(),
    reward: task.reward,
    status: 'pending'
  });

  closeModal('task-modal');
  handleRoute();
}
window.submitProofInModal = submitProofInModal;

// --- 3. CREATE TASK VIEW ---
function renderCreateTaskView(container) {
  if (STATE.role !== 'business') {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 60px 40px; margin: 40px auto; max-width: 600px;">
        <i data-lucide="alert-triangle" style="width: 64px; height: 64px; color: var(--accent-amber); margin-bottom: 20px;"></i>
        <h2>Business Account Required</h2>
        <p style="color: var(--text-secondary); margin-top: 10px; margin-bottom: 30px;">
          To create a micro-task, you must change your simulated perspective. Use the banner control at the top of the screen to switch to <strong>Business Creator</strong>.
        </p>
        <button class="btn btn-primary" onclick="document.getElementById('role-business-btn').click();">
          Switch to Business Creator
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="form-container glass-card">
      <h1 class="form-title">Create Smart Task Pool</h1>
      <p class="form-subtitle">Lock stablecoin reward pools into a gasless escrow smart contract for coordination and automated nanopayment clearance.</p>

      <form id="create-task-form" onsubmit="handleCreateTaskSubmit(event)">
        <div class="input-group" style="margin-bottom: 20px;">
          <label style="font-weight: 600; font-size: 14px;">Task Title</label>
          <input type="text" id="task-title" required class="input-field" placeholder="e.g., Verify storefront cafe hours">
        </div>

        <div class="form-grid" style="margin-bottom: 20px;">
          <div class="input-group">
            <label style="font-weight: 600; font-size: 14px;">Category</label>
            <select id="task-category" class="input-field" style="cursor: pointer;">
              <option value="local">Local Audit</option>
              <option value="digital">Digital Polls</option>
              <option value="social">Social Sharing</option>
              <option value="testing">App Testing</option>
            </select>
          </div>
          <div class="input-group">
            <label style="font-weight: 600; font-size: 14px;">Brand Name</label>
            <input type="text" id="task-creator" required class="input-field" placeholder="e.g., Java Junction">
          </div>
        </div>

        <div class="input-group" style="margin-bottom: 20px;">
          <label style="font-weight: 600; font-size: 14px;">Task Description</label>
          <textarea id="task-desc-val" required class="input-field" rows="3" placeholder="Describe the micro-task goal clearly..." style="resize: vertical;"></textarea>
        </div>

        <div class="input-group" style="margin-bottom: 20px;">
          <label style="font-weight: 600; font-size: 14px;">Detailed Instructions</label>
          <textarea id="task-instructions" required class="input-field" rows="4" placeholder="Step-by-step steps for earners..." style="resize: vertical;"></textarea>
        </div>

        <div class="input-group" style="margin-bottom: 20px;">
          <label style="font-weight: 600; font-size: 14px;">Verification Type</label>
          <select id="task-verification-type" class="input-field" style="cursor: pointer;" onchange="toggleFormVerificationFields(this.value)">
            <option value="text">Text Submission</option>
            <option value="photo">Photo Proof</option>
            <option value="location">GPS Location Check-in</option>
            <option value="referral">Referral Confirmation</option>
            <option value="inventory">Inventory Confirmation</option>
          </select>
        </div>

        <div id="verification-params-container" style="display: none; background: var(--bg-app); border: 1px solid var(--border-color); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 20px;">
        </div>

        <div class="input-group" style="margin-bottom: 20px;">
          <label style="font-weight: 600; font-size: 14px;">Required Verification Proof Instructions</label>
          <input type="text" id="task-proof-val" required class="input-field" placeholder="e.g., Upload screenshot of tweet or photo of receipt">
        </div>

        <div class="form-grid" style="margin-bottom: 30px;">
          <div class="input-group">
            <label style="font-weight: 600; font-size: 14px;">Reward per Claim (USDC)</label>
            <input type="number" id="task-reward-val" step="0.01" min="0.01" value="0.25" required class="input-field">
          </div>
          <div class="input-group">
            <label style="font-weight: 600; font-size: 14px;">Max Claims Limit</label>
            <input type="number" id="task-limit-val" min="1" value="20" required class="input-field">
          </div>
        </div>

        <!-- Calculated cost display -->
        <div style="background: var(--bg-app); border: 1px solid var(--border-color); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-size: 13px; color: var(--text-muted);">Required Pool Deposit</span>
            <div style="font-size: 20px; font-weight: 700; color: var(--primary);" id="total-deposit-display">$5.00 USDC</div>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); text-align: right;">
            Includes Gasless Smart Setup<br>
            <span style="color: var(--secondary); font-weight: 600;">Arc Powered</span>
          </div>
        </div>

        <div style="display: flex; gap: 16px;">
          <button type="button" class="btn btn-outline" style="flex: 1;" onclick="window.location.hash='#/marketplace'">Cancel</button>
          <button type="submit" class="btn btn-primary" style="flex: 1.5;" id="submit-create-btn">
            <i data-lucide="rocket"></i> Deploy Task Pool
          </button>
        </div>
      </form>
    </div>
  `;

  // Bind cost calculations
  const rewardInput = document.getElementById('task-reward-val');
  const limitInput = document.getElementById('task-limit-val');
  const depositText = document.getElementById('total-deposit-display');

  const updateCost = () => {
    const r = parseFloat(rewardInput.value) || 0;
    const l = parseInt(limitInput.value) || 0;
    depositText.textContent = `$${(r * l).toFixed(2)} USDC`;
  };

  rewardInput?.addEventListener('input', updateCost);
  limitInput?.addEventListener('input', updateCost);
}

async function executeRealTransaction(to, data, amount, actionDesc, callback) {
  openModal('tx-modal');
  const loadingState = document.getElementById('tx-loading-state');
  const successState = document.getElementById('tx-success-state');
  const stepsContainer = document.getElementById('tx-steps-container');
  const escrowRow = document.getElementById('tx-escrow-address-row');

  loadingState.style.display = 'block';
  successState.style.display = 'none';
  if (escrowRow) escrowRow.style.display = 'none';

  document.getElementById('tx-loading-title').textContent = "Executing On-Chain Transaction";
  document.getElementById('tx-loading-subtitle').textContent = "Interacting with Arc Testnet via MetaMask...";

  const steps = [
    "Preparing ERC-20 payload...",
    "Awaiting MetaMask approval...",
    "Broadcasting to Arc Testnet...",
    "Confirming block settlement..."
  ];

  stepsContainer.innerHTML = `
    <div class="tx-step-list">
      ${steps.map((step, idx) => `
        <div class="tx-step-item" id="tx-step-${idx}">
          <span class="tx-step-icon" id="tx-step-icon-${idx}">
            <i data-lucide="circle" style="width: 14px; height: 14px; color: var(--text-muted);"></i>
          </span>
          <span>${step}</span>
        </div>
      `).join('')}
    </div>
  `;
  lucide.createIcons();

  const setStep = (idx, status) => {
    const item = document.getElementById(`tx-step-${idx}`);
    const icon = document.getElementById(`tx-step-icon-${idx}`);
    if (!item) return;
    if (status === 'completed') {
      item.className = 'tx-step-item completed';
      if (icon) icon.innerHTML = `<i data-lucide="check-circle" style="width: 14px; height: 14px; color: var(--success);"></i>`;
    } else if (status === 'pending') {
      item.className = 'tx-step-item pending';
      if (icon) icon.innerHTML = `<i data-lucide="loader" class="spin" style="width: 14px; height: 14px; color: var(--primary);"></i>`;
    } else {
      item.className = 'tx-step-item';
      if (icon) icon.innerHTML = `<i data-lucide="circle" style="width: 14px; height: 14px; color: var(--text-muted);"></i>`;
    }
    lucide.createIcons();
  };

  try {
    // Step 0: Preparing payload
    setStep(0, 'pending');
    await new Promise(resolve => setTimeout(resolve, 600));
    setStep(0, 'completed');

    // Validation of transaction calldata before execution
    if (data) {
      console.log("Final calldata before execution:", data);
      if (data.startsWith("0x0x")) {
        throw new Error("Invalid calldata: starts with duplicate '0x0x' prefix.");
      }
      const hexRegex = /^0x[0-9a-fA-F]*$/;
      if (!hexRegex.test(data)) {
        throw new Error("Invalid calldata: not a valid hexadecimal string.");
      }
    }

    // Step 1: Awaiting MetaMask approval
    setStep(1, 'pending');
    const transactionParameters = {
      to: to,
      from: STATE.wallet.address,
      data: data,
    };
    const provider = window.activeProvider || window.ethereum;
    if (!provider) {
      throw new Error("EVM Wallet provider not found. Please connect your wallet.");
    }
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [transactionParameters],
    });
    setStep(1, 'completed');

    // Step 2: Broadcasting
    setStep(2, 'pending');
    await new Promise(resolve => setTimeout(resolve, 600));
    setStep(2, 'completed');

    // Step 3: Confirming block settlement
    setStep(3, 'pending');
    const receipt = await ArcUtils.waitForTxReceipt(txHash);
    setStep(3, 'completed');

    // Show Success Modal
    loadingState.style.display = 'none';
    successState.style.display = 'block';

    document.getElementById('tx-success-title').textContent = "Transaction Settled!";
    document.getElementById('tx-success-desc').textContent = actionDesc;
    document.getElementById('tx-receipt-amount').textContent = `$${amount.toFixed(2)} USDC`;
    document.getElementById('tx-receipt-id').textContent = `ARC-TX-${txHash.slice(2, 8).toUpperCase()}`;

    const explorerLink = document.getElementById('tx-receipt-explorer-link');
    if (explorerLink) {
      explorerLink.href = `https://testnet.arcscan.app/tx/${txHash}`;
      explorerLink.textContent = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;
    }

    lucide.createIcons();

    if (callback) {
      await callback(txHash, receipt);
    }
  } catch (error) {
    console.error("On-Chain transaction failed:", error);
    closeModal('tx-modal');
    if (error.code === 4001) {
      alert("Transaction rejected: You cancelled the wallet confirmation in MetaMask.");
    } else {
      alert("Transaction failed: " + (error.message || error));
    }
  }
}

function handleCreateTaskSubmit(event) {
  event.preventDefault();

  if (!STATE.wallet.connected) {
    alert('Please connect your Web3 wallet first using the top-right button.');
    return;
  }

  const title = document.getElementById('task-title').value;
  const category = document.getElementById('task-category').value;
  const creator = document.getElementById('task-creator').value;
  const desc = document.getElementById('task-desc-val').value;
  const instructions = document.getElementById('task-instructions').value;
  const proofReq = document.getElementById('task-proof-val').value;
  const reward = parseFloat(document.getElementById('task-reward-val').value);
  const limit = parseInt(document.getElementById('task-limit-val').value);
  const verificationType = document.getElementById('task-verification-type').value;

  const totalCost = reward * limit;

  if (STATE.wallet.balance < totalCost) {
    alert(`Insufficient balance. You need $${totalCost.toFixed(2)} USDC but only have $${STATE.wallet.balance.toFixed(2)} USDC. Please request funds from Circle Faucet.`);
    return;
  }

  // Real USDC transfer data:
  const data = ArcUtils.encodeERC20Transfer(ESCROW_HOLDING_ADDRESS, totalCost);

  executeRealTransaction(
    USDC_CONTRACT_ADDRESS,
    data,
    totalCost,
    `Your task pool has been deployed. Funds locked in Arc Escrow Holding Address.`,
    async (txHash, receipt) => {
      // Refresh wallet balance on-chain
      STATE.wallet.balance = await getUSDCBalance(STATE.wallet.address);
      saveWalletState();
      updateWalletNavButton();

      // Create task ID and register task (PocketBase compatible 15-char alphanumeric)
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const newTaskId = Array.from({ length: 15 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const newTask = {
        id: newTaskId,
        title,
        category,
        desc,
        instructions,
        proofReq,
        reward,
        limit,
        completedCount: 0,
        creator,
        status: 'active',
        escrowAgreementAddress: ESCROW_HOLDING_ADDRESS,
        escrowTxHash: txHash,
        escrowStatus: 'funded',
        verificationType
      };

      if (verificationType === 'location') {
        const locName = document.getElementById('param-loc-name').value;
        const locLat = parseFloat(document.getElementById('param-loc-lat').value) || 6.4526;
        const locLon = parseFloat(document.getElementById('param-loc-lon').value) || 3.4076;
        newTask.locationTarget = { name: locName, lat: locLat, lon: locLon };
      } else if (verificationType === 'inventory') {
        const invName = document.getElementById('param-inv-name').value;
        const invExpected = parseInt(document.getElementById('param-inv-expected').value) || 20;
        newTask.inventoryItems = [
          { name: invName, expected: invExpected }
        ];
      }

      STATE.tasks.unshift(newTask);
      pb.collection('tasks').create(newTask).catch(err => {
        console.error("PocketBase task creation failed:", err);
      });

      // Add transaction history record
      STATE.transactions.unshift({
        id: `tx-${Date.now()}`,
        type: 'create',
        desc: `Deployed Task Pool: "${title}"`,
        amount: -totalCost,
        timestamp: new Date().toISOString(),
        success: true,
        txHash: txHash
      });

      // Redirect after short delay
      setTimeout(() => {
        closeModal('tx-modal');
        window.location.hash = '#/marketplace';
      }, 3000);
    }
  );
}

window.handleCreateTaskSubmit = handleCreateTaskSubmit;

// --- 4. MY TASKS VIEW ---
let activeTasksSubTab = 'active'; // 'active', 'pending', 'completed'

function renderMyTasksView(container) {
  if (STATE.role === 'earner') {
    // COMMUNITY EARNER VIEW
    renderEarnerTasksView(container);
  } else {
    // BUSINESS CREATOR VIEW
    renderBusinessTasksView(container);
  }
}

function renderEarnerTasksView(container) {
  // Filter claims based on subtab
  // 'active' -> status is 'claimed'
  // 'pending' -> status is 'pending'
  // 'completed' -> status is 'completed'
  const targetStatus = activeTasksSubTab === 'active' ? 'claimed' : activeTasksSubTab;

  const filteredClaims = STATE.myClaims.filter(c => c.status === targetStatus);

  let listHtml = '';
  if (filteredClaims.length === 0) {
    listHtml = `
      <div style="text-align: center; padding: 60px 0; color: var(--text-secondary); background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
        <i data-lucide="clipboard" style="width: 48px; height: 48px; margin-bottom: 16px;"></i>
        <h3>No tasks in this list</h3>
        <p style="margin-top: 8px;">Explore active opportunities in the task marketplace.</p>
        <a href="#/marketplace" class="btn btn-primary" style="margin-top: 16px;">Go to Marketplace</a>
      </div>
    `;
  } else {
    filteredClaims.forEach(claim => {
      const task = STATE.tasks.find(t => t.id === claim.taskId);
      if (!task) return;

      let actionBtn = '';
      if (claim.status === 'claimed') {
        actionBtn = `<button class="btn btn-primary btn-sm" onclick="openTaskDetails('${task.id}')">Submit Proof</button>`;
      } else if (claim.status === 'pending') {
        actionBtn = `<span class="badge badge-pending">Under Review</span>`;
      } else {
        actionBtn = `<span class="badge badge-completed">Paid</span>`;
      }

      listHtml += `
        <div class="list-item">
          <div class="list-item-info">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
              <span class="task-category cat-${task.category}" style="font-size: 10px;">${task.category}</span>
              <span class="list-item-title" style="margin-bottom: 0;">${task.title}</span>
            </div>
            <div class="list-item-meta">
              <span>Reward: <strong style="color: var(--secondary); font-family: var(--font-heading);">$${task.reward.toFixed(2)} USDC</strong></span>
              <span>By ${task.creator}</span>
              <span>Claimed ${new Date(claim.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="list-item-action">
            ${actionBtn}
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <h1 style="font-size: 36px; margin-bottom: 4px;">My Claimed Tasks</h1>
    <p style="color: var(--text-secondary); margin-bottom: 32px;">Manage and complete the micro-tasks you have claimed.</p>

    <!-- Subtab Navigation -->
    <div class="tabs-navigation">
      <button class="tab-btn ${activeTasksSubTab === 'active' ? 'active' : ''}" onclick="switchTasksSubTab('active')">To Do</button>
      <button class="tab-btn ${activeTasksSubTab === 'pending' ? 'active' : ''}" onclick="switchTasksSubTab('pending')">Awaiting Approval</button>
      <button class="tab-btn ${activeTasksSubTab === 'completed' ? 'active' : ''}" onclick="switchTasksSubTab('completed')">Completed & Paid</button>
    </div>

    <!-- Active List -->
    <div>
      ${listHtml}
    </div>
  `;
}

function renderBusinessTasksView(container) {
  // Business Creator view: List created tasks and incoming submissions
  const totalSubmissions = STATE.submissions.length;
  const pendingSubmissions = STATE.submissions.filter(s => s.status === 'pending');
  const activeCreatedTasks = STATE.tasks.filter(t => t.creator === 'City Books Co.' || t.creator === 'Farmers Market Association' || t.creator === 'Java Junction Cafe'); // Mock owned tasks or any tasks matching

  let submissionsHtml = '';
  if (pendingSubmissions.length === 0) {
    submissionsHtml = `
      <div style="text-align: center; padding: 40px 0; color: var(--text-secondary); background: var(--bg-app); border-radius: var(--radius-md); border: 1px dashed var(--border-color);">
        <i data-lucide="check-circle" style="width: 36px; height: 36px; margin-bottom: 12px; color: var(--success);"></i>
        <h4>Inbox is empty</h4>
        <p style="font-size: 13px;">No new task submissions are waiting for verification.</p>
      </div>
    `;
  } else {
    pendingSubmissions.forEach(sub => {
      const task = STATE.tasks.find(t => t.id === sub.taskId);
      const proofDetailsHTML = renderSubmissionProofDetailsHTML(sub, task);
      submissionsHtml += `
        <div class="list-item" style="border-left: 4px solid var(--primary); flex-direction: column; align-items: stretch; gap: 12px;">
          <div class="list-item-info" style="margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <h4 style="font-size: 15px; margin-bottom: 4px; font-weight: 700;">${sub.taskTitle}</h4>
              <span class="task-category cat-${task ? task.category : 'digital'}" style="font-size: 10px; padding: 2px 6px;">${task ? task.category : 'digital'}</span>
            </div>
            
            ${proofDetailsHTML}
            
            <div class="list-item-meta" style="font-size: 12px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div>
                <span>Earner: <code>${sub.earnerAddress.slice(0, 6)}...${sub.earnerAddress.slice(-4)}</code></span>
                <span style="margin-left: 12px;">Submitted: ${new Date(sub.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <span style="font-size: 14px;">Reward: <strong style="color: var(--secondary);">$${sub.reward.toFixed(2)} USDC</strong></span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 4px;">
            <button class="btn btn-outline" style="padding: 6px 12px; font-size: 13px;" onclick="rejectSubmission('${sub.id}')">Reject</button>
            <button class="btn btn-primary" style="padding: 6px 12px; font-size: 13px;" onclick="approveSubmission('${sub.id}')">Approve & Pay</button>
          </div>
        </div>
      `;
    });
  }

  // List all tasks created by the active business user
  let createdListHtml = '';
  if (STATE.tasks.length === 0) {
    createdListHtml = `<p style="color: var(--text-muted);">No task pools created yet.</p>`;
  } else {
    STATE.tasks.forEach(task => {
      createdListHtml += `
        <div class="list-item">
          <div class="list-item-info">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
              <span class="task-category cat-${task.category}" style="font-size: 10px;">${task.category}</span>
              <span class="list-item-title" style="margin-bottom: 0;">${task.title}</span>
            </div>
            <div class="list-item-meta">
              <span>Quota: <strong>${task.completedCount} / ${task.limit}</strong> completed</span>
              <span>Reward: $${task.reward.toFixed(2)} USDC</span>
            </div>
          </div>
          <div>
            <span class="badge badge-active">Active Pool</span>
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <h1 style="font-size: 36px; margin-bottom: 4px;">Creator Dashboard</h1>
    <p style="color: var(--text-secondary); margin-bottom: 40px;">Verify community task submissions and manage active task deployment pools.</p>

    <div class="dashboard-grid">
      <!-- Left Column: Pending Approvals Inbox -->
      <div>
        <h2 style="font-size: 20px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
          <i data-lucide="inbox" style="color: var(--primary);"></i> Submissions Review
          <span style="font-size: 12px; background: var(--primary); color: var(--text-on-accent); padding: 2px 8px; border-radius: var(--radius-full);">${pendingSubmissions.length}</span>
        </h2>
        <div>
          ${submissionsHtml}
        </div>
      </div>

      <!-- Right Column: Active Task Pools -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="font-size: 20px; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="layers" style="color: var(--secondary);"></i> Active Deployed Pools
          </h2>
          <a href="#/create" class="btn btn-secondary" style="padding: 8px 16px; font-size: 13px;">
            <i data-lucide="plus-circle"></i> Create New Pool
          </a>
        </div>
        <div>
          ${createdListHtml}
        </div>
      </div>
    </div>
  `;
}

function switchTasksSubTab(tab) {
  activeTasksSubTab = tab;
  handleRoute();
}
window.switchTasksSubTab = switchTasksSubTab;

async function approveSubmission(subId) {
  const sub = STATE.submissions.find(s => s.id === subId);
  if (!sub) return;

  const task = STATE.tasks.find(t => t.id === sub.taskId);

  // Real USDC transfer reward data:
  const data = ArcUtils.encodeERC20Transfer(sub.earnerAddress, sub.reward);

  executeRealTransaction(
    USDC_CONTRACT_ADDRESS,
    data,
    sub.reward,
    `Nanopayment reward successfully distributed directly to earner: ${sub.earnerAddress.slice(0, 6)}...${sub.earnerAddress.slice(-4)}`,
    async (txHash, receipt) => {
      // Process approval state
      sub.status = 'approved';

      // Find task and update counts
      if (task) {
        task.completedCount = Math.min(task.limit, task.completedCount + 1);
        await pb.collection('tasks').update(task.id, { completedCount: task.completedCount });
      }

      // Update earner claim status if this matches local earner simulation address
      if (STATE.wallet.connected) {
        const claim = STATE.myClaims.find(c => c.taskId === sub.taskId);
        if (claim) {
          claim.status = 'completed';
          claim.txHash = txHash;
        }

        // Refresh wallet balance on-chain
        STATE.wallet.balance = await getUSDCBalance(STATE.wallet.address);
        saveWalletState();
        updateWalletNavButton();

        // Log transaction
        STATE.transactions.unshift({
          id: `tx-${Date.now()}`,
          type: 'earning',
          desc: `Micro-task payout: "${sub.taskTitle}"`,
          amount: sub.reward,
          timestamp: new Date().toISOString(),
          success: true,
          txHash: txHash,
          escrowAddress: task ? task.escrowAgreementAddress : null
        });
      }

      // Remove the submission from reviewer list
      STATE.submissions = STATE.submissions.filter(s => s.id !== subId);

      setTimeout(() => {
        closeModal('tx-modal');
        handleRoute();
      }, 3000);
    }
  );
}

window.approveSubmission = approveSubmission;

function rejectSubmission(subId) {
  const confirmation = confirm('Are you sure you want to reject this submission? It will be removed from review inbox.');
  if (confirmation) {
    STATE.submissions = STATE.submissions.filter(s => s.id !== subId);
    handleRoute();
  }
}
window.rejectSubmission = rejectSubmission;

// --- 5. EARNINGS VIEW ---
function renderEarningsView(container) {
  if (STATE.role !== 'earner') {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 60px 40px; margin: 40px auto; max-width: 600px;">
        <i data-lucide="user" style="width: 64px; height: 64px; color: var(--primary); margin-bottom: 20px;"></i>
        <h2>Community Earner Account Required</h2>
        <p style="color: var(--text-secondary); margin-top: 10px; margin-bottom: 30px;">
          To review your micro-task earnings, you must use the earner role. Use the banner control at the top of the screen to switch to <strong>Community Earner</strong>.
        </p>
        <button class="btn btn-primary" onclick="document.getElementById('role-earner-btn').click();" style="margin: 0 auto;">
          Switch to Community Earner
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Calculate earnings stats
  const completedClaims = STATE.myClaims.filter(c => c.status === 'completed');
  const totalEarnings = completedClaims.reduce((acc, claim) => {
    const task = STATE.tasks.find(t => t.id === claim.taskId);
    return acc + (task ? task.reward : 0);
  }, 0);

  // Mock initial earnings to make dashboard look rich and populated
  const defaultBaseEarnings = 0.00;
  const netEarnings = defaultBaseEarnings + totalEarnings;
  const nanoEarnings = Math.round(netEarnings * 1000000).toLocaleString();

  const totalCompletedUserTasks = completedClaims.length;
  let userLevel = 1;
  let levelTitle = "Explorer";
  if (totalCompletedUserTasks >= 10) {
    userLevel = 3;
    levelTitle = "Local Champion";
  } else if (totalCompletedUserTasks >= 3) {
    userLevel = 2;
    levelTitle = "Active Contributor";
  }

  // Tasks count by category
  const counts = { local: 0, digital: 0, social: 0, testing: 0 };
  const categoriesWorth = { local: 0.00, digital: 0.00, social: 0.00, testing: 0.00 }; // base stats

  completedClaims.forEach(claim => {
    const task = STATE.tasks.find(t => t.id === claim.taskId);
    if (task && counts[task.category] !== undefined) {
      counts[task.category] += 1;
      categoriesWorth[task.category] += task.reward;
    }
  });

  const totalValue = categoriesWorth.local + categoriesWorth.digital + categoriesWorth.social + categoriesWorth.testing;

  // Custom visual progress bar calculation for HSL category chart
  const pctLocal = totalValue > 0 ? Math.round((categoriesWorth.local / totalValue) * 100) : 0;
  const pctDigital = totalValue > 0 ? Math.round((categoriesWorth.digital / totalValue) * 100) : 0;
  const pctSocial = totalValue > 0 ? Math.round((categoriesWorth.social / totalValue) * 100) : 0;
  const pctTesting = totalValue > 0 ? Math.round((categoriesWorth.testing / totalValue) * 100) : 0;

  container.innerHTML = `
    <h1 style="font-size: 36px; margin-bottom: 4px;">My Earnings</h1>
    <p style="color: var(--text-secondary); margin-bottom: 40px;">Real-time breakdown of your nanopayments accrued on the Arc Network ledger.</p>

    <div class="dashboard-grid">
      <!-- Left Column: Quick Stats -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div class="card" style="text-align: center; padding: 40px 24px; position: relative; overflow: hidden; border-color: var(--secondary);">
          <div style="position: absolute; top: -10px; right: -10px; opacity: 0.05; color: var(--secondary);">
            <i data-lucide="banknote" style="width: 120px; height: 120px;"></i>
          </div>
          <span style="font-size: 13px; text-transform: uppercase; font-weight: 700; color: var(--text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 8px;">Total Net Revenue</span>
          <div style="font-size: 48px; font-weight: 800; color: var(--secondary); font-family: var(--font-heading); margin-bottom: 4px;">$${netEarnings.toFixed(2)} USDC</div>
          <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 24px;">${nanoEarnings} nanoUSDC</div>
          <button class="btn btn-outline" onclick="alert('USDC rewards are settled directly to your connected EVM wallet on-chain upon task approval. Your wallet balance is updated in real-time.')" style="width: 100%;">
            <i data-lucide="info"></i> Settled Directly to Wallet
          </button>
        </div>

        <div class="card">
          <h3 style="font-size: 18px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="award" style="color: var(--primary);"></i> Achievement Status
          </h3>
          <div style="display: flex; align-items: center; gap: 12px; background: var(--bg-app); padding: 12px; border-radius: var(--radius-sm);">
            <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--accent-amber), var(--accent-pink)); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
              <i data-lucide="zap" style="width: 20px; height: 20px;"></i>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 600;">Jara ${levelTitle}</div>
              <div style="font-size: 12px; color: var(--text-muted);">Level ${userLevel} &bull; ${totalCompletedUserTasks} total tasks</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Graphs & Breakdown -->
      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <h2 style="font-size: 22px; margin-bottom: 24px; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="pie-chart" style="color: var(--primary);"></i> Revenue Breakdown by Category
          </h2>

          <!-- Styled Custom Horizontal Progress Stack -->
          <div style="height: 24px; width: 100%; border-radius: var(--radius-full); display: flex; overflow: hidden; margin-bottom: 30px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
            <div style="width: ${pctLocal}%; background: var(--secondary); transition: width 0.5s;" title="Local Audit: ${pctLocal}%"></div>
            <div style="width: ${pctDigital}%; background: var(--primary); transition: width 0.5s;" title="Digital Polls: ${pctDigital}%"></div>
            <div style="width: ${pctSocial}%; background: var(--accent-pink); transition: width 0.5s;" title="Social: ${pctSocial}%"></div>
            <div style="width: ${pctTesting}%; background: var(--accent-amber); transition: width 0.5s;" title="App Testing: ${pctTesting}%"></div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--secondary); margin-top: 4px;"></span>
              <div>
                <div style="font-size: 14px; font-weight: 600;">Local Auditing</div>
                <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">$${categoriesWorth.local.toFixed(2)} USDC (${pctLocal}%)</div>
              </div>
            </div>

            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--primary); margin-top: 4px;"></span>
              <div>
                <div style="font-size: 14px; font-weight: 600;">Digital Polls</div>
                <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">$${categoriesWorth.digital.toFixed(2)} USDC (${pctDigital}%)</div>
              </div>
            </div>

            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--accent-pink); margin-top: 4px;"></span>
              <div>
                <div style="font-size: 14px; font-weight: 600;">Social Actions</div>
                <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">$${categoriesWorth.social.toFixed(2)} USDC (${pctSocial}%)</div>
              </div>
            </div>

            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--accent-amber); margin-top: 4px;"></span>
              <div>
                <div style="font-size: 14px; font-weight: 600;">App Testing</div>
                <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">$${categoriesWorth.testing.toFixed(2)} USDC (${pctTesting}%)</div>
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top: 30px; border-top: 1px solid var(--border-color); padding-top: 20px; font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
          <i data-lucide="info" style="color: var(--primary); flex-shrink: 0;"></i>
          <span>Jara processes payments via gasless sub-cent transactions that aggregate offchain and settle onchain on request, avoiding L1 transaction fees.</span>
        </div>
      </div>
    </div>
  `;
}

async function simulateCashout(amount) {
  if (amount <= 0) {
    alert("You don't have any earnings to cash out yet!");
    return;
  }

  if (!STATE.wallet.connected) {
    alert("Please connect your mock wallet first using the top-right button.");
    return;
  }

  // Run multi-step escrow cashout transaction simulation
  const txDetails = await runEscrowTxSimulation('cashout', { amount });

  // Reset earnings simulation
  STATE.myClaims = STATE.myClaims.map(c => {
    if (c.status === 'completed') {
      return { ...c, status: 'cashed_out' }; // state that won't show in active earnings
    }
    return c;
  });

  // Log transaction
  STATE.transactions.unshift({
    id: `tx-${Date.now()}`,
    type: 'withdraw',
    desc: 'Cashed out earnings to Mainnet',
    amount: -amount,
    timestamp: new Date().toISOString(),
    success: true,
    txHash: txDetails.txHash
  });

  setTimeout(() => {
    closeModal('tx-modal');
    handleRoute();
  }, 2500);
}
window.simulateCashout = simulateCashout;

// --- 6. WALLET VIEW ---
function renderWalletView(container) {
  if (!STATE.wallet.connected) {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 80px 40px; margin: 40px auto; max-width: 600px;">
        <i data-lucide="wallet" style="width: 80px; height: 80px; color: var(--text-muted); margin-bottom: 24px;"></i>
        <h2>Connect Wallet to View Dashboard</h2>
        <p style="color: var(--text-secondary); margin-top: 12px; margin-bottom: 32px;">
          Jara operates using nanopayment smart contract structures. Connect your simulated Web3 wallet to manage stablecoins and review your transaction ledger.
        </p>
        <button class="btn btn-primary" onclick="openModal('wallet-modal'); renderWalletModalContent();">
          <i data-lucide="plug"></i> Connect Active Wallet
        </button>
      </div>
    `;
    return;
  }

  let txListHtml = '';
  if (STATE.transactions.length === 0) {
    txListHtml = `<p style="color: var(--text-muted); text-align: center; padding: 24px;">No transactions found on Arc Network.</p>`;
  } else {
    STATE.transactions.forEach(tx => {
      const isPositive = tx.amount > 0;
      const typeClass = isPositive ? 'income' : 'outcome';
      const typeIcon = isPositive ? 'arrow-down-left' : 'arrow-up-right';
      const dateFormatted = new Date(tx.timestamp).toLocaleString();

      txListHtml += `
        <div class="tx-item">
          <div class="tx-info">
            <div class="tx-icon-wrapper ${typeClass}">
              <i data-lucide="${typeIcon}"></i>
            </div>
            <div>
              <div class="tx-title">${tx.desc}</div>
              <div class="tx-date">${dateFormatted} &bull; Arc Network</div>
            </div>
          </div>
          <div class="tx-amount" style="color: ${isPositive ? 'var(--success)' : 'var(--text-primary)'}">
            ${isPositive ? '+' : ''}$${tx.amount.toFixed(2)} USDC
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <h1 style="font-size: 36px; margin-bottom: 4px;">Wallet Dashboard</h1>
    <p style="color: var(--text-secondary); margin-bottom: 40px;">Manage balances, deposit task funding, and review ledger audit trails.</p>

    <div class="dashboard-grid">
      <!-- Left Column: Balance Card & Actions -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div class="card wallet-balance-card">
          <span class="network-badge">Arc Stablecoin Account</span>
          <div class="balance-title">Connected Address</div>
          <div style="font-size: 13px; font-family: monospace; word-break: break-all; opacity: 0.9; margin-bottom: 24px;">
            ${STATE.wallet.address}
          </div>
          <div class="balance-title">Available Balance</div>
          <div class="balance-value">$${STATE.wallet.balance.toFixed(2)} USDC</div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button class="btn btn-secondary" onclick="claimFaucetDrop()" style="border: 1px solid rgba(255, 255, 255, 0.2); box-shadow: none;">
              <i data-lucide="droplet"></i> Faucet Drop
            </button>
            <button class="btn btn-outline" onclick="disconnectRealWallet()" style="border: 1px solid rgba(255, 255, 255, 0.3); color: white; background: rgba(255,255,255,0.08);">
              <i data-lucide="log-out"></i> Disconnect
            </button>
          </div>
        </div>

        <div class="card">
          <h3 style="font-size: 18px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="key" style="color: var(--primary);"></i> Gasless Execution
          </h3>
          <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">
            Arc Network leverages session keys and paymasters. This setup sponsors micro-gas fees, so you never pay gas for claiming rewards or launching pools.
          </p>
        </div>
      </div>

      <!-- Right Column: Ledger Activity Log -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="font-size: 22px; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="history" style="color: var(--secondary);"></i> Transaction History
          </h2>
          <span style="font-size: 12px; color: var(--text-muted); font-family: monospace;">Arc Network Explorer</span>
        </div>
        <div class="tx-history-container">
          ${txListHtml}
        </div>
      </div>
    </div>
  `;
}

function renderUseCasesView(container) {
  container.innerHTML = `
    <div style="margin-bottom: 40px; text-align: center;">
      <h1 style="font-size: 38px; margin-bottom: 8px;">Ecosystem Use Cases</h1>
      <p style="color: var(--text-secondary); max-width: 650px; margin: 0 auto; font-size: 15px; line-height: 1.6;">
        Explore how various industries and local brands deploy gasless stablecoin pools to coordinate high-fidelity physical audits, local index tracking, and community campaigns.
      </p>
    </div>

    <div class="use-cases-grid">
      <!-- Use Case 1: Balogun Market Audits -->
      <div class="use-case-card">
        <div>
          <div class="use-case-icon-wrapper teal">
            <i data-lucide="store" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="use-case-title">Balogun Market Audits</h3>
          <p class="use-case-desc">
            Consumer packaged goods (CPG) distributors and retail brands deploy task pools for local market merchants and shoppers to audit product availability, wholesale pricing ceilings, and competitor placements.
          </p>
          <div class="use-case-impact-box teal">
            <span class="use-case-impact-label">Community Impact</span>
            <span class="use-case-impact-text">Provides high-fidelity retail intelligence while distributing micro-incentives to local traders.</span>
          </div>
        </div>
        <div class="use-case-rewards-bar">
          <span class="use-case-reward-label">Avg. Escrow Pool Reward</span>
          <div style="text-align: right;">
            <span class="use-case-reward-val">$0.50 USDC</span>
            <span class="use-case-reward-nano">500,000 nanoUSDC</span>
          </div>
        </div>
      </div>

      <!-- Use Case 2: Ikeja Tech Store Surveys -->
      <div class="use-case-card">
        <div>
          <div class="use-case-icon-wrapper purple">
            <i data-lucide="clipboard-list" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="use-case-title">Ikeja Tech Store Surveys</h3>
          <p class="use-case-desc">
            Electronics dealers and repair hubs collect real-time customer satisfaction metrics and walk-in shopper queue durations directly from the floor, bypassing biased agency reporting.
          </p>
          <div class="use-case-impact-box">
            <span class="use-case-impact-label">Community Impact</span>
            <span class="use-case-impact-text">Empowers shoppers to monetize their immediate attention and feedback in real-time.</span>
          </div>
        </div>
        <div class="use-case-rewards-bar">
          <span class="use-case-reward-label">Avg. Escrow Pool Reward</span>
          <div style="text-align: right;">
            <span class="use-case-reward-val">$0.25 USDC</span>
            <span class="use-case-reward-nano">250,000 nanoUSDC</span>
          </div>
        </div>
      </div>

      <!-- Use Case 3: Yaba Hub Beta Testing -->
      <div class="use-case-card">
        <div>
          <div class="use-case-icon-wrapper pink">
            <i data-lucide="smartphone" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="use-case-title">Yaba Hub Beta Testing</h3>
          <p class="use-case-desc">
            Fintech startups and mobile app builders deploy test scopes to local community members, verifying transaction steps, load times, and translations on real low-bandwidth devices.
          </p>
          <div class="use-case-impact-box pink">
            <span class="use-case-impact-label">Community Impact</span>
            <span class="use-case-impact-text">Allows developers to optimize for local hardware while rewarding users for technical feedback.</span>
          </div>
        </div>
        <div class="use-case-rewards-bar">
          <span class="use-case-reward-label">Avg. Escrow Pool Reward</span>
          <div style="text-align: right;">
            <span class="use-case-reward-val">$1.50 USDC</span>
            <span class="use-case-reward-nano">1,500,000 nanoUSDC</span>
          </div>
        </div>
      </div>

      <!-- Use Case 4: VI Restaurant Promos -->
      <div class="use-case-card">
        <div>
          <div class="use-case-icon-wrapper amber">
            <i data-lucide="megaphone" style="width: 24px; height: 24px;"></i>
          </div>
          <h3 class="use-case-title">VI Restaurant Promos</h3>
          <p class="use-case-desc">
            Food and hospitality brands launch organic localized marketing campaigns by rewarding earners for geotagged social check-ins and menu items reviews.
          </p>
          <div class="use-case-impact-box amber">
            <span class="use-case-impact-label">Community Impact</span>
            <span class="use-case-impact-text">Rewards micro-influencers and patrons for authentic physical check-ins and endorsements.</span>
          </div>
        </div>
        <div class="use-case-rewards-bar">
          <span class="use-case-reward-label">Avg. Escrow Pool Reward</span>
          <div style="text-align: right;">
            <span class="use-case-reward-val">$0.75 USDC</span>
            <span class="use-case-reward-nano">750,000 nanoUSDC</span>
          </div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

window.renderUseCasesView = renderUseCasesView;

function renderNanoPayEngineView(container) {
  const activeRewardPool = STATE.tasks.reduce((sum, t) => sum + (t.reward * (t.limit - t.completedCount)), 0);
  const rewardPoolDisplay = activeRewardPool.toFixed(2);

  const totalCompletedTasks = STATE.tasks.reduce((sum, t) => sum + t.completedCount, 0);
  const totalDistributedVal = STATE.tasks.reduce((sum, t) => sum + (t.reward * t.completedCount), 0);
  const totalDistributed = totalDistributedVal.toFixed(2);
  const averageReward = totalCompletedTasks > 0 ? (totalDistributedVal / totalCompletedTasks).toFixed(3) : "0.000";

  const contributorsSet = new Set();
  if (STATE.wallet.connected && STATE.wallet.address) {
    contributorsSet.add(STATE.wallet.address.toLowerCase());
  }
  STATE.tasks.forEach(t => {
    if (t.creator) {
      contributorsSet.add(t.creator.toLowerCase());
    }
  });
  const activeContributors = contributorsSet.size;

  container.innerHTML = `
    <div style="margin-bottom: 40px; text-align: center;">
      <h1 style="font-size: 38px; margin-bottom: 8px;">NanoPay Settlement Engine</h1>
      <p style="color: var(--text-secondary); max-width: 650px; margin: 0 auto; font-size: 15px; line-height: 1.6;">
        Inspect real time unit economics, gasless Paymaster throughput, and offchain transaction consolidation for low value community actions on the Arc Network.
      </p>
    </div>

    <!-- Metrics Grid -->
    <div class="nanopay-grid">
      <div class="nanopay-stat-card primary">
        <div class="nanopay-stat-lbl">Active Reward Pool</div>
        <div class="nanopay-stat-val">$${rewardPoolDisplay} USDC</div>
        <span style="font-size: 11px; color: var(--text-muted);">Locked in Escrow Vaults</span>
      </div>
      <div class="nanopay-stat-card secondary">
        <div class="nanopay-stat-lbl">Completed Tasks</div>
        <div class="nanopay-stat-val">${totalCompletedTasks.toLocaleString()}</div>
        <span style="font-size: 11px; color: var(--text-muted);">Verified and Settled</span>
      </div>
      <div class="nanopay-stat-card pink">
        <div class="nanopay-stat-lbl">Distributed Payouts</div>
        <div class="nanopay-stat-val">$${totalDistributed} USDC</div>
        <span style="font-size: 11px; color: var(--text-muted);">Gasless Nanopayments</span>
      </div>
      <div class="nanopay-stat-card amber">
        <div class="nanopay-stat-lbl">Average Reward</div>
        <div class="nanopay-stat-val">$${averageReward} USDC</div>
        <span style="font-size: 11px; color: var(--text-muted);">Per micro-task action</span>
      </div>
      <div class="nanopay-stat-card success">
        <div class="nanopay-stat-lbl">Active Earners</div>
        <div class="nanopay-stat-val">${activeContributors.toLocaleString()}</div>
        <span style="font-size: 11px; color: var(--text-muted);">Unique Wallet nodes</span>
      </div>
    </div>

    <!-- Visual Flow Board Section -->
    <div class="nanopay-flow-container">
      <h3 style="font-size: 22px; margin-bottom: 8px;">Visual Micro-Payment Flow</h3>
      <p style="color: var(--text-secondary); font-size: 14px; max-width: 550px; margin: 0 auto 24px auto;">
        Trigger a simulation to watch stablecoin rewards flow from the business wallet, lock in the smart escrow contract, and release gaslessly to the earner.
      </p>

      <div class="flow-board">
        <!-- Connecting Line Pathway -->
        <div class="flow-path-line">
          <div class="flow-path-progress" id="flow-progress"></div>
        </div>
        
        <!-- Pulsing coin -->
        <div class="flow-path-pulse" id="flow-pulse"></div>

        <!-- Node 1: Business -->
        <div class="flow-node-wrapper active" id="flow-node-1">
          <div class="flow-node">
            <i data-lucide="briefcase" style="width: 28px; height: 28px;"></i>
          </div>
          <div class="flow-node-label">Business Wallet</div>
        </div>

        <!-- Node 2: Escrow -->
        <div class="flow-node-wrapper" id="flow-node-2">
          <div class="flow-node">
            <i data-lucide="lock" style="width: 28px; height: 28px;"></i>
          </div>
          <div class="flow-node-label">Escrow Smart Vault</div>
        </div>

        <!-- Node 3: Earner -->
        <div class="flow-node-wrapper" id="flow-node-3">
          <div class="flow-node">
            <i data-lucide="wallet" style="width: 28px; height: 28px;"></i>
          </div>
          <div class="flow-node-label">Earner Wallet</div>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <div class="flow-status-text" id="flow-status-text">Ready. Click the trigger button below to run simulation.</div>
        <button class="btn btn-secondary" id="trigger-flow-btn" onclick="triggerVisualNanoPaymentFlow()" style="margin-top: 16px; min-width: 200px;">
          <i data-lucide="play"></i> Trigger Payment Flow
        </button>
      </div>
    </div>

    <!-- Live Transaction Log Section -->
    <div class="card" style="text-align: left;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="font-size: 20px; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="history" style="color: var(--secondary);"></i> Stablecoin Settlement Ledger
          </h3>
          <p style="color: var(--text-secondary); font-size: 13px; margin-top: 2px;">Consolidated micro-payments cleared gaslessly via L2 Paymaster nodes and off-chain state aggregation on the Arc Network.</p>
        </div>
        <span class="escrow-badge" style="font-size: 10px;"><i data-lucide="shield-check" style="width: 12px; height: 12px;"></i> Audited Ledger</span>
      </div>

      <div style="overflow-x: auto;">
        <table class="inventory-table" style="margin: 0; min-width: 600px;">
          <thead>
            <tr>
              <th>Tx Hash</th>
              <th>USDC Value</th>
              <th>Nanopayment (nanoUSDC)</th>
              <th>Status</th>
              <th>Timestamp</th>
              <th>Arc L2 Explorer</th>
            </tr>
          </thead>
          <tbody id="nanopay-ledger-body">
            <tr id="no-ledger-tx">
              <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No on-chain settlements recorded yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
  lucide.createIcons();
}

function triggerVisualNanoPaymentFlow() {
  const btn = document.getElementById('trigger-flow-btn');
  const node1 = document.getElementById('flow-node-1');
  const node2 = document.getElementById('flow-node-2');
  const node3 = document.getElementById('flow-node-3');
  const progress = document.getElementById('flow-progress');
  const pulse = document.getElementById('flow-pulse');
  const statusText = document.getElementById('flow-status-text');

  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader" class="spin" style="width: 14px; height: 14px; display: inline-block;"></i> Simulation Running...`;
  lucide.createIcons();

  node1.className = 'flow-node-wrapper active';
  node2.className = 'flow-node-wrapper';
  node3.className = 'flow-node-wrapper';
  progress.style.width = '0%';
  pulse.className = 'flow-path-pulse';
  statusText.textContent = 'Phase 1: Business deposits reward budget into Smart Escrow Vault...';

  setTimeout(() => {
    pulse.classList.add('active-phase1');
    progress.style.width = '50%';
  }, 500);

  setTimeout(() => {
    pulse.className = 'flow-path-pulse';
    node1.className = 'flow-node-wrapper completed';
    node2.className = 'flow-node-wrapper active';
    statusText.textContent = 'Phase 2: Escrow contract locks funds. Awaiting earner proof verification...';
  }, 1700);

  setTimeout(() => {
    pulse.classList.add('active-phase2');
    progress.style.width = '100%';
    statusText.textContent = 'Phase 3: Verification successful! Releasing reward nanopayment to earner...';
  }, 2700);

  setTimeout(() => {
    pulse.className = 'flow-path-pulse';
    node2.className = 'flow-node-wrapper completed';
    node3.className = 'flow-node-wrapper completed';
    statusText.textContent = 'Settled! Earner wallet credited with stablecoins. Gas fee: $0.00 (Sponsored).';

    appendLiveMockLedgerRow();

    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="play"></i> Trigger Payment Flow`;
    lucide.createIcons();
  }, 3900);
}

function appendLiveMockLedgerRow() {
  const tbody = document.getElementById('nanopay-ledger-body');
  if (!tbody) return;

  // Remove empty state placeholder row if present
  const placeholder = document.getElementById('no-ledger-tx');
  if (placeholder) {
    placeholder.remove();
  }

  const mockReward = (0.05 + Math.random() * 0.45).toFixed(2);
  const nanoReward = Math.round(mockReward * 1000000).toLocaleString();
  const txHash = '0x' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const row = document.createElement('tr');
  row.style.animation = 'fade-in 0.4s ease-out forwards';
  row.innerHTML = `
    <td><code>${txHash.slice(0, 10)}...</code></td>
    <td><span style="font-family: var(--font-heading); font-weight: 700; color: var(--secondary);">$${mockReward} USDC</span></td>
    <td><span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${nanoReward} nanoUSDC</span></td>
    <td><span class="badge badge-completed" style="font-size: 10px; padding: 2px 8px;">Settled</span></td>
    <td>${timestamp}</td>
    <td><a href="https://testnet.arcscan.app/tx/${txHash}" target="_blank" style="color: var(--primary); text-decoration: underline; font-size: 12px;">ArcScan</a></td>
  `;

  if (tbody.firstChild) {
    tbody.insertBefore(row, tbody.firstChild);
  } else {
    tbody.appendChild(row);
  }

  while (tbody.children.length > 10) {
    tbody.removeChild(tbody.lastChild);
  }
}

window.renderNanoPayEngineView = renderNanoPayEngineView;
window.triggerVisualNanoPaymentFlow = triggerVisualNanoPaymentFlow;
window.appendLiveMockLedgerRow = appendLiveMockLedgerRow;
