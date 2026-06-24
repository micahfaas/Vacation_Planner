// Sign-in / sign-up screen, shown when no user session is active.
import { supabase } from './supabase.js';
import { el } from './dom.js';

export function signOut() {
  return supabase.auth.signOut();
}

// Render the auth screen into #vp-root. The onAuthStateChange listener in
// main.js takes over once a session is established. Optional `initialMode`
// supports 'signin' | 'signup' | 'forgot'.
export function renderAuthScreen(initialMode) {
  const root = document.getElementById('vp-root');
  root.innerHTML = '';
  let mode = initialMode === 'signup' || initialMode === 'forgot' ? initialMode : 'signin';

  const card = el('div', { class: 'vp-auth-card' });

  function draw(notice) {
    card.innerHTML = '';
    card.appendChild(el('img', {
      src: 'odynaut-logo.png', alt: 'Odynaut',
      style: { display: 'block', margin: '0 auto 6px', width: '170px', height: 'auto' }
    }));
    card.appendChild(el('p', { class: 'vp-auth-sub' },
      mode === 'signin' ? 'Sign in to sync your trips across devices.'
      : mode === 'signup' ? 'Create an account to start planning.'
      : 'Enter your email and we will send a link to reset your password.'));

    const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const pass = mode === 'forgot' ? null : el('input', {
      type: 'password',
      placeholder: mode === 'signin' ? 'Password' : 'Password (min. 6 characters)',
      autocomplete: mode === 'signin' ? 'current-password' : 'new-password'
    });
    const msg = el('div', { class: 'vp-auth-msg' });
    if (notice) msg.textContent = notice;
    const submitLabel = mode === 'signin' ? 'Sign in'
      : mode === 'signup' ? 'Create account'
      : 'Send reset link';
    const submit = el('button', { class: 'vp-auth-submit' }, submitLabel);

    function setMsg(text, isError) {
      msg.textContent = text;
      msg.classList.toggle('vp-auth-msg-error', !!isError);
    }

    async function doSubmit() {
      const e = email.value.trim();
      const p = pass ? pass.value : '';
      if (!e || (mode !== 'forgot' && !p)) {
        setMsg(mode === 'forgot' ? 'Enter your email.' : 'Enter your email and password.', true);
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Please wait…';
      try {
        if (mode === 'signin') {
          const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
          if (error) throw error;
        } else if (mode === 'signup') {
          const { data, error } = await supabase.auth.signUp({ email: e, password: p });
          if (error) throw error;
          const identities = data.user && data.user.identities;
          if (Array.isArray(identities) && identities.length === 0) {
            // Supabase returns an obfuscated user with no identities when the
            // email is already registered.
            mode = 'signin';
            draw('That email is already registered — please sign in.');
            return;
          }
          if (!data.session) {
            // email confirmation is enabled — no session yet
            mode = 'signin';
            draw('Account created. Check your email to confirm, then sign in.');
            return;
          }
        } else {
          // forgot — send Supabase recovery email. redirectTo must be on the
          // Supabase Auth allow-list (Dashboard → Auth → URL Configuration).
          const { error } = await supabase.auth.resetPasswordForEmail(e, {
            redirectTo: location.origin + location.pathname
          });
          if (error) throw error;
          mode = 'signin';
          draw('Check your email for a reset link. It expires in 1 hour.');
          return;
        }
        // success: onAuthStateChange swaps in the app
      } catch (err) {
        setMsg(err && err.message ? err.message : 'Something went wrong.', true);
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    }

    submit.addEventListener('click', doSubmit);
    if (pass) {
      email.addEventListener('keydown', ev => { if (ev.key === 'Enter') pass.focus(); });
      pass.addEventListener('keydown', ev => { if (ev.key === 'Enter') doSubmit(); });
    } else {
      email.addEventListener('keydown', ev => { if (ev.key === 'Enter') doSubmit(); });
    }

    card.appendChild(el('label', {}, 'Email'));
    card.appendChild(email);
    if (pass) {
      card.appendChild(el('label', {}, 'Password'));
      card.appendChild(pass);
    }
    card.appendChild(msg);
    card.appendChild(submit);

    // Social sign-in (not on the password-reset screen). The Google provider is
    // configured in the Supabase dashboard; on success the browser redirects to
    // Google and back to redirectTo, where supabase-js completes the session and
    // the onAuthStateChange listener in main.js routes into the app.
    if (mode !== 'forgot') {
      card.appendChild(el('div', { class: 'vp-auth-divider' }, el('span', {}, 'or')));
      const googleBtn = el('button', { type: 'button', class: 'vp-auth-oauth' },
        el('i', { class: 'ti ti-brand-google', 'aria-hidden': 'true' }),
        el('span', {}, 'Continue with Google'));
      googleBtn.addEventListener('click', async () => {
        googleBtn.disabled = true;
        setMsg('', false);
        try {
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + location.pathname }
          });
          if (error) throw error;
          // Success: the browser is redirecting to Google now.
        } catch (err) {
          setMsg(err && err.message ? err.message : 'Could not start Google sign-in.', true);
          googleBtn.disabled = false;
        }
      });
      card.appendChild(googleBtn);
    }

    if (mode === 'signin') {
      const forgot = el('button', { class: 'vp-auth-toggle vp-auth-forgot' }, 'Forgot password?');
      forgot.addEventListener('click', () => { mode = 'forgot'; draw(); });
      card.appendChild(forgot);
    }

    const toggleLabel = mode === 'signin' ? 'New here? Create an account'
      : mode === 'signup' ? 'Have an account? Sign in'
      : 'Back to sign in';
    const toggle = el('button', { class: 'vp-auth-toggle' }, toggleLabel);
    toggle.addEventListener('click', () => {
      mode = mode === 'signin' ? 'signup' : 'signin';
      draw();
    });
    card.appendChild(toggle);

    // Privacy policy footer link — required by Apple before an account is created.
    const privacy = el('a', {
      class: 'vp-auth-privacy',
      href: 'privacy.html',
      target: '_blank',
      rel: 'noopener',
    }, 'Privacy policy');
    card.appendChild(privacy);
  }

  draw();
  root.appendChild(el('div', { class: 'vp-auth-wrap' }, card));
}

// Shown after a user clicks the reset-password link in their email. Supabase
// has already placed them in a recovery session; updateUser() with the new
// password finishes the flow.
export function renderResetScreen() {
  const root = document.getElementById('vp-root');
  root.innerHTML = '';
  const card = el('div', { class: 'vp-auth-card' });

  card.appendChild(el('img', {
    src: 'odynaut-logo.png', alt: 'Odynaut',
    style: { display: 'block', margin: '0 auto 6px', width: '170px', height: 'auto' }
  }));
  card.appendChild(el('p', { class: 'vp-auth-sub' }, 'Set a new password to finish signing in.'));

  const pass = el('input', {
    type: 'password', placeholder: 'New password (min. 6 characters)', autocomplete: 'new-password'
  });
  const confirm = el('input', {
    type: 'password', placeholder: 'Confirm new password', autocomplete: 'new-password'
  });
  const msg = el('div', { class: 'vp-auth-msg' });
  const submit = el('button', { class: 'vp-auth-submit' }, 'Update password');

  function setMsg(text, isError) {
    msg.textContent = text;
    msg.classList.toggle('vp-auth-msg-error', !!isError);
  }

  async function doSubmit() {
    const p = pass.value;
    const c = confirm.value;
    if (!p || p.length < 6) { setMsg('Password must be at least 6 characters.', true); return; }
    if (p !== c) { setMsg('Passwords do not match.', true); return; }
    submit.disabled = true;
    submit.textContent = 'Please wait…';
    try {
      const { error } = await supabase.auth.updateUser({ password: p });
      if (error) throw error;
      // Clean any leftover recovery hash from the URL before main.js takes over.
      if (location.hash) history.replaceState({}, '', location.pathname + location.search);
      setMsg('Password updated. Loading your trips…', false);
      // onAuthStateChange (USER_UPDATED) will fire; main.js routes into the app.
    } catch (err) {
      setMsg(err && err.message ? err.message : 'Could not update password.', true);
      submit.disabled = false;
      submit.textContent = 'Update password';
    }
  }

  submit.addEventListener('click', doSubmit);
  pass.addEventListener('keydown', ev => { if (ev.key === 'Enter') confirm.focus(); });
  confirm.addEventListener('keydown', ev => { if (ev.key === 'Enter') doSubmit(); });

  card.appendChild(el('label', {}, 'New password'));
  card.appendChild(pass);
  card.appendChild(el('label', {}, 'Confirm password'));
  card.appendChild(confirm);
  card.appendChild(msg);
  card.appendChild(submit);

  root.appendChild(el('div', { class: 'vp-auth-wrap' }, card));
}
