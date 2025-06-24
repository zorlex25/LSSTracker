// ==UserScript==
// @name         LSSTracker Loader
// @version      1.0
// @description  LSSTracker loader with profile verification and user authentication
// @author       zorlex25
// @match        *://www.leitstellenspiel.de/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @updateURL    https://raw.githubusercontent.com/zorlex25/LSSTracker/main/loader.user.js
// @downloadURL  https://raw.githubusercontent.com/zorlex25/LSSTracker/main/loader.user.js
// ==/UserScript==

;(async () => {
  // 🔐 Configuration
  const CONFIG = {
    MAIN_CODE_URL: "https://raw.githubusercontent.com/zorlex25/LSSTracker/main/LSSTracker.js",
    USER_LIST_URL: "https://raw.githubusercontent.com/zorlex25/LSSTracker/main/allowed_users.json",
    ENCRYPTION_KEY: "FreiwilligeFeuerwehrLemgo",
    DOMAIN_CHECK: "www.leitstellenspiel.de",
    VERSION: "1.0",
    CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
    TIMEOUT: 8000,
    DEBUG: false, // Production mode - minimal logging
  }

  // 🔒 Basic security check
  if (window.location.hostname !== CONFIG.DOMAIN_CHECK) {
    return
  }

  // 📡 HTTP request function
  function fetchRemote(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        timeout: CONFIG.TIMEOUT,
        headers: {
          "Cache-Control": "no-cache",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        onload: (response) => {
          if (response.status === 200) {
            resolve(response.responseText)
          } else {
            reject(new Error(`HTTP ${response.status}: ${response.statusText}`))
          }
        },
        onerror: (error) => reject(new Error("Network error: " + error)),
        ontimeout: () => reject(new Error("Request timeout")),
      })
    })
  }

  // 💾 Simple cache
  const Cache = {
    set: (key, data) => {
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        version: CONFIG.VERSION,
      }
      GM_setValue(`lss_${key}`, JSON.stringify(cacheData))
    },

    get: (key) => {
      try {
        const cached = GM_getValue(`lss_${key}`, null)
        if (!cached) return null

        const cacheData = JSON.parse(cached)

        if (cacheData.version !== CONFIG.VERSION || Date.now() - cacheData.timestamp > CONFIG.CACHE_DURATION) {
          GM_deleteValue(`lss_${key}`)
          return null
        }

        return cacheData.data
      } catch {
        GM_deleteValue(`lss_${key}`)
        return null
      }
    },
  }

  // 🛡️ CSRF Token Management
  function getCSRFToken() {
    // Check meta tag
    const metaToken = document.querySelector('meta[name="csrf-token"]')
    if (metaToken) return metaToken.getAttribute("content")

    // Check Rails CSRF token
    const railsToken = document.querySelector('meta[name="authenticity_token"]')
    if (railsToken) return railsToken.getAttribute("content")

    // Check form inputs
    const formToken = document.querySelector('input[name="authenticity_token"]')
    if (formToken) return formToken.value

    // Check for _token input (Laravel style)
    const laravelToken = document.querySelector('input[name="_token"]')
    if (laravelToken) return laravelToken.value

    // Check window object
    if (window.csrfToken) return window.csrfToken

    // Check for common CSRF token patterns in scripts
    const scripts = document.querySelectorAll("script")
    for (const script of scripts) {
      if (script.textContent) {
        const tokenMatch = script.textContent.match(/csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i)
        if (tokenMatch) return tokenMatch[1]

        const authMatch = script.textContent.match(/authenticity[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i)
        if (authMatch) return authMatch[1]
      }
    }

    return null
  }

  // 🔧 Enhanced jQuery with CSRF token support
  function setupEnhancedJQuery() {
    if (typeof $ === "undefined" || typeof jQuery === "undefined") {
      return
    }

    const csrfToken = getCSRFToken()
    const originalAjax = $.ajax
    const originalPost = $.post

    // Enhanced $.ajax with CSRF token and proper headers
    $.ajax = function (options) {
      // Add CSRF token and required headers for POST requests
      if (options.type === "POST" || options.method === "POST") {
        options.headers = options.headers || {}

        // Add CSRF token
        if (csrfToken) {
          options.headers["X-CSRF-Token"] = csrfToken
          options.headers["authenticity_token"] = csrfToken

          if (options.data && typeof options.data === "object") {
            options.data.authenticity_token = csrfToken
            options.data._token = csrfToken
          }
        }

        // Add required headers
        options.headers["X-Requested-With"] = "XMLHttpRequest"
        options.headers["Accept"] = "application/json, text/javascript, */*; q=0.01"
        options.headers["Content-Type"] =
          options.headers["Content-Type"] || "application/x-www-form-urlencoded; charset=UTF-8"
        options.headers["Referer"] = window.location.href
      }

      const jqXHR = originalAjax.call(this, options)

      // Enhanced error handling
      jqXHR.fail((xhr, status, error) => {
        // If it's a 401/403 error, try to refresh CSRF token
        if (xhr.status === 401 || xhr.status === 403) {
          const newToken = getCSRFToken()
          if (newToken && newToken !== csrfToken) {
            if (options.headers) {
              options.headers["X-CSRF-Token"] = newToken
              options.headers["authenticity_token"] = newToken
            }
            setTimeout(() => {
              $.ajax(options)
            }, 1000)
          }
        }
      })

      return jqXHR
    }

    // Enhanced $.post with CSRF token
    $.post = (url, data, success, dataType) => {
      const options = {
        type: "POST",
        url: url,
        data: data,
        success: success,
        dataType: dataType,
      }
      return $.ajax(options)
    }
  }

  // 👤 Get current user ID and profile data
  function getCurrentUserData() {
    let userId = null
    let userName = null

    // Method 1: Profile link in navbar
    const profileLink = document.querySelector('a[href^="/profile/"]')
    if (profileLink) {
      const match = profileLink.href.match(/\/profile\/(\d+)/)
      if (match) {
        userId = Number.parseInt(match[1])
        userName = profileLink.textContent.trim()
      }
    }

    // Method 2: User menu
    if (!userId) {
      const userMenu = document.querySelector('#user_menu a[href^="/profile/"]')
      if (userMenu) {
        const match = userMenu.href.match(/\/profile\/(\d+)/)
        if (match) {
          userId = Number.parseInt(match[1])
          userName = userMenu.textContent.trim()
        }
      }
    }

    // Method 3: Navbar profile link
    if (!userId) {
      const navbarProfile = document.querySelector('#navbar_profile_link')
      if (navbarProfile) {
        const match = navbarProfile.href.match(/\/profile\/(\d+)/)
        if (match) {
          userId = Number.parseInt(match[1])
          userName = navbarProfile.textContent.trim()
        }
      }
    }

    // Method 4: Page source analysis
    if (!userId) {
      const scripts = document.querySelectorAll("script")
      for (const script of scripts) {
        if (script.textContent && script.textContent.includes("user_id")) {
          const match = script.textContent.match(/user_id["\s]*[:=]["\s]*(\d+)/)
          if (match) {
            userId = Number.parseInt(match[1])
            break
          }
        }
      }
    }

    return { userId, userName }
  }

  // 🏠 Check if main page
  function isMainPage() {
    return window.location.pathname === "/" || window.location.pathname === "/missions" || window.location.pathname === ""
  }

  // 🚪 Force logout unauthorized user
  function forceLogout() {
    GM_notification({
      text: "Du bist nicht berechtigt, dieses Script zu nutzen! Script wird deaktiviert.",
      title: "LSSTracker - Zugriff verweigert",
      timeout: 5000,
    })

    // Try multiple logout methods
    const logoutBtn = document.getElementById("logout_button")
    if (logoutBtn) {
      logoutBtn.click()
    } else {
      // Try alternative logout methods
      const logoutLink = document.querySelector('a[href*="sign_out"]')
      if (logoutLink) {
        logoutLink.click()
      } else {
        window.location.href = "/users/sign_out"
      }
    }
  }

  // 🔍 Verify user access with profile data
  async function verifyUserAccess() {
    try {
      const userData = getCurrentUserData()
      if (!userData.userId) {
        throw new Error("Could not determine user ID")
      }

      // Check cache first
      const cachedResult = Cache.get("user_check")
      if (cachedResult && cachedResult.userId === userData.userId) {
        return {
          allowed: cachedResult.allowed,
          allowedUsers: cachedResult.allowedUsers,
          userData: userData,
        }
      }

      // Load encrypted user list from GitHub
      const res = await fetchRemote(CONFIG.USER_LIST_URL)
      const json = JSON.parse(res)
      const encryptedText = json.encryptedUserIDs

      if (!encryptedText) {
        throw new Error("Invalid user list format")
      }

      // Decrypt using CryptoJS
      const bytes = CryptoJS.AES.decrypt(encryptedText, CONFIG.ENCRYPTION_KEY)
      const decryptedStr = bytes.toString(CryptoJS.enc.Utf8)

      if (!decryptedStr) throw new Error("Decryption failed")

      const allowedUsers = JSON.parse(decryptedStr)

      if (!Array.isArray(allowedUsers)) {
        throw new Error("Invalid user data")
      }

      const isAllowed = allowedUsers.includes(userData.userId)

      // Cache the result
      Cache.set("user_check", {
        userId: userData.userId,
        allowed: isAllowed,
        allowedUsers: allowedUsers,
      })

      // 🚨 FORCE LOGOUT IF NOT AUTHORIZED
      if (!isAllowed) {
        if (CONFIG.DEBUG) {
          console.log(`❌ User ${userData.userId} (${userData.userName}) not authorized`)
        }
        forceLogout()
        return { allowed: false, allowedUsers: null, userData: null }
      }

      if (CONFIG.DEBUG) {
        console.log(`✅ User ${userData.userId} (${userData.userName}) authorized`)
      }

      return { allowed: true, allowedUsers: allowedUsers, userData: userData }
    } catch (error) {
      if (CONFIG.DEBUG) {
        console.error("❌ User verification failed:", error)
      }
      // On any error, deny access and force logout for security
      forceLogout()
      return { allowed: false, allowedUsers: null, userData: null }
    }
  }

  // 📥 Load main code
  async function loadMainCode() {
    try {
      let mainCode = Cache.get("main_code")

      if (!mainCode) {
        mainCode = await fetchRemote(CONFIG.MAIN_CODE_URL)

        if (!mainCode.includes("function") && !mainCode.includes("=>")) {
          throw new Error("Invalid code received")
        }

        Cache.set("main_code", mainCode)
      }

      return mainCode
    } catch (error) {
      throw error
    }
  }

  // 🚀 Execute the main code
  function executeMainCode(code, allowedUsers, userData) {
    try {
      // Set global variables that the main script expects
      window.lssTrackerAllowedUsers = allowedUsers
      window.lssTrackerUserData = userData

      // Setup enhanced jQuery with CSRF support
      setupEnhancedJQuery()

      // Remove userscript headers if present
      const cleanCode = code.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, "")

      // Create execution function with necessary globals
      const executor = new Function(
        "window",
        "document",
        "$",
        "jQuery",
        "GM_xmlhttpRequest",
        "GM_addStyle",
        "GM_setValue",
        "GM_getValue",
        "GM_deleteValue",
        "GM_notification",
        "console",
        cleanCode,
      )

      // Execute with full environment
      executor(
        window,
        document,
        $,
        jQuery,
        GM_xmlhttpRequest,
        GM_addStyle,
        GM_setValue,
        GM_getValue,
        GM_deleteValue,
        GM_notification,
        console,
      )

      // Show success notification
      GM_notification({
        text: `LSSTracker erfolgreich geladen für ${userData.userName}`,
        title: "LSSTracker",
        timeout: 3000,
      })
    } catch (error) {
      if (CONFIG.DEBUG) {
        console.error("❌ Code execution failed:", error)
      }
      GM_notification({
        text: "Fehler beim Laden des LSSTracker Scripts",
        title: "LSSTracker - Fehler",
        timeout: 5000,
      })
      throw error
    }
  }

  // 🎯 Main initialization
  async function initialize() {
    try {
      // Only run on main pages
      if (!isMainPage()) return

      // Show loading notification
      if (CONFIG.DEBUG) {
        GM_notification({
          text: "LSSTracker wird geladen...",
          title: "LSSTracker",
          timeout: 2000,
        })
      }

      // Verify user access with profile data
      const accessResult = await verifyUserAccess()
      if (!accessResult.allowed) {
        // User has already been logged out by verifyUserAccess
        return
      }

      // Load and execute main code
      const mainCode = await loadMainCode()
      executeMainCode(mainCode, accessResult.allowedUsers, accessResult.userData)

      // Success logging
      if (CONFIG.DEBUG) {
        console.log("✅ LSSTracker loaded successfully")
      }
    } catch (error) {
      // Silent fail in production mode
      if (CONFIG.DEBUG) {
        console.error("❌ LSSTracker loader failed:", error)
      }
      GM_notification({
        text: "LSSTracker konnte nicht geladen werden",
        title: "LSSTracker - Fehler",
        timeout: 5000,
      })
    }
  }

  // 🔄 Wait for page readiness
  function startLoader() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize)
    } else {
      // Add small delay to ensure page is fully loaded
      setTimeout(initialize, 1500)
    }
  }

  // 🎬 Start the loader
  startLoader()
})()
