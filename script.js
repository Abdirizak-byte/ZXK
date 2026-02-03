/* ========================================
   MAIN JAVASCRIPT FILE
   Handles all interactions for the portfolio
   ======================================== */

// ========================================
// MOBILE MENU TOGGLE
// ========================================
const menu = document.querySelector('#menu-icon');
const navbar = document.querySelector('.navbar');

if (menu && navbar) {
  // Toggle menu on click
  menu.onclick = () => {
    menu.classList.toggle('bx-x');
    navbar.classList.toggle('active');
  };

  // Close menu on scroll
  window.onscroll = () => {
    menu.classList.remove('bx-x');
    navbar.classList.remove('active');
  };
}

// ========================================
// SMOOTH SCROLL FOR NAVIGATION LINKS
// ========================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href !== '#' && href.length > 1) {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }
  });
});

// ========================================
// TYPED.JS ANIMATION (Home Section)
// ========================================
const typedElement = document.querySelector('.multiple-text');
if (typedElement && typeof Typed !== 'undefined') {
  const typed = new Typed('.multiple-text', {
    strings: [
      'Stream Overlay',
      'YouTube Editing',
      'Stream Production',
      'Discord Building',
      'Chat Moderation',
      'Reality Show Experience'
    ],
    typeSpeed: 100,
    backSpeed: 100,
    backDelay: 1200,
    loop: true,
  });
}

// ========================================
// CURSOR GLOW EFFECT
// ========================================
const glow = document.querySelector('.cursor-glow');
if (glow) {
  window.addEventListener('mousemove', (e) => {
    glow.style.left = e.clientX + 'px';
    glow.style.top = e.clientY + 'px';
  });
}

// ========================================
// ACTIVE NAVIGATION HIGHLIGHT ON SCROLL
// ========================================
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.navbar a');

window.addEventListener('scroll', () => {
  let current = '';
  
  sections.forEach(section => {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.clientHeight;
    if (window.pageYOffset >= sectionTop - 150) {
      current = section.getAttribute('id');
    }
  });

  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === `#${current}`) {
      link.classList.add('active');
    }
  });
});

// ========================================
// CONTACT FORM - SERVICE SELECTION
// ========================================
const serviceOptions = document.querySelectorAll('.terminal-option');
const selectedServiceInput = document.getElementById('selectedService');

if (serviceOptions.length > 0 && selectedServiceInput) {
  serviceOptions.forEach(option => {
    option.addEventListener('click', function () {
      // Remove selected class from all options
      serviceOptions.forEach(opt => opt.classList.remove('selected'));
      
      // Add selected class to clicked option
      this.classList.add('selected');
      
      // Update hidden input with selected service
      selectedServiceInput.value = this.dataset.service;
    });
  });
}

// ========================================
// CONTACT FORM - WEB3FORMS INTEGRATION
// ========================================
const form = document.getElementById('terminalContactForm');
const responseDiv = document.getElementById('terminalResponse');

if (form && responseDiv) {
  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    // Check if service is selected
    const service = selectedServiceInput ? selectedServiceInput.value : '';
    
    if (!service) {
      responseDiv.className = 'terminal-response show error';
      responseDiv.innerHTML = `
        <p class="terminal-line">ERROR: No service selected</p>
        <p class="terminal-line">Please select a service option [1-5]</p>
      `;
      return;
    }

    // Show loading state
    const submitBtn = form.querySelector('.execute');
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = '[SENDING...]';
    submitBtn.disabled = true;

    try {
      // Get form data
      const formData = new FormData(form);
      
      // Send to Web3Forms
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        // Success response
        responseDiv.className = 'terminal-response show success';
        responseDiv.innerHTML = `
          <p class="terminal-line">✓ Message sent successfully!</p>
          <p class="terminal-line">✓ Processing request...</p>
          <p class="terminal-line">✓ You'll receive a response within 24h</p>
          <p class="terminal-line blank"></p>
          <p class="terminal-line">Thank you for reaching out!</p>
        `;

        // Reset form after delay
        setTimeout(() => {
          form.reset();
          serviceOptions.forEach(opt => opt.classList.remove('selected'));
          if (selectedServiceInput) selectedServiceInput.value = '';
          responseDiv.classList.remove('show');
        }, 5000);
      } else {
        // Error response
        throw new Error(data.message || 'Form submission failed');
      }
    } catch (error) {
      // Error handling
      responseDiv.className = 'terminal-response show error';
      responseDiv.innerHTML = `
        <p class="terminal-line">ERROR: Failed to send message</p>
        <p class="terminal-line">${error.message}</p>
        <p class="terminal-line">Please try again or contact directly</p>
      `;
    } finally {
      // Reset button state
      submitBtn.textContent = originalBtnText;
      submitBtn.disabled = false;
    }
  });

  // Reset button handler
  form.addEventListener('reset', function () {
    serviceOptions.forEach(opt => opt.classList.remove('selected'));
    if (selectedServiceInput) selectedServiceInput.value = '';
    responseDiv.classList.remove('show');
  });
}

// ========================================
// MY WORK PAGE NAVIGATION
// Only runs on mywork.html page
// ========================================
window.addEventListener('load', () => {
  const workContent = document.querySelector('.work-content');
  
  // Check if we're on the My Work page
  if (!workContent) return;

  console.log('🚀 My Work navigation initialized');

  // Function to show a specific section
  function showSection(targetId) {
    console.log(`🖱️ Navigating to: ${targetId}`);
    
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
      section.classList.remove('active');
    });
    
    // Show target section
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
      targetSection.classList.add('active');
      console.log(`✅ Section "${targetId}" displayed`);
    } else {
      console.error(`❌ Section "${targetId}" not found`);
      return;
    }
    
    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(nav => {
      nav.classList.remove('active');
    });
    
    const sidebarLink = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    if (sidebarLink) {
      sidebarLink.classList.add('active');
    }
    
    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  
  // Handle clicks on all elements with data-target attribute
  document.addEventListener('click', (e) => {
    const clickable = e.target.closest('[data-target]');
    if (!clickable) return;
    
    e.preventDefault();
    const target = clickable.getAttribute('data-target');
    if (target) {
      showSection(target);
    }
  });
  
  // Show first section on page load
  const firstSection = document.querySelector('.content-section');
  if (firstSection) {
    const firstId = firstSection.getAttribute('id');
    showSection(firstId || 'intro');
  }
  
  // Sidebar collapse functionality
  const collapseBtn = document.getElementById('collapseBtn');
  const sidebar = document.getElementById('sidebar');
  
  if (collapseBtn && sidebar) {
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const workContentEl = document.querySelector('.work-content');
      if (workContentEl) {
        workContentEl.classList.toggle('sidebar-collapsed');
      }
    });
  }
  
  console.log('✅ Navigation ready');
});

// ========================================
// INTERSECTION OBSERVER FOR FADE-IN ANIMATIONS
// ========================================
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Observe all sections for fade-in effect
document.querySelectorAll('section').forEach(section => {
  observer.observe(section);
});

// ========================================
// PERFORMANCE OPTIMIZATION
// ========================================

// Debounce function for scroll events
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Optimized scroll handler
const handleScroll = debounce(() => {
  // Add any scroll-based animations here
}, 100);

window.addEventListener('scroll', handleScroll);

// ========================================
// LOG INITIALIZATION
// ========================================
console.log('✅ Portfolio scripts loaded successfully');
console.log('📍 Current page:', window.location.pathname);