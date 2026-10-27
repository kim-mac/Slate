//! Windows-owned profile identity and private object security. No environment paths.
use std::{
    ffi::OsString,
    fs::File,
    io,
    os::windows::{ffi::OsStringExt, io::AsRawHandle},
    path::{Path, PathBuf},
};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                GetSecurityInfo, SE_FILE_OBJECT,
            },
            EqualSid, GetAce, GetSecurityDescriptorControl, GetTokenInformation, TokenUser,
            ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
            PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES, SE_DACL_PROTECTED, TOKEN_QUERY,
            TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
        UI::Shell::{GetProfileType, GetUserProfileDirectoryW},
    },
};

fn denied() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "untrusted coordination authority",
    )
}
fn win(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error((error.code().0 as u32 & 0xffff) as i32)
}
struct Token(HANDLE);
impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
pub(crate) struct Local(pub PSECURITY_DESCRIPTOR);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(Some(HLOCAL(self.0 .0)));
        }
    }
}
pub(crate) struct User {
    storage: Vec<u64>,
}
impl User {
    pub(crate) fn current() -> io::Result<Self> {
        Self::for_process(unsafe { GetCurrentProcess() })
    }
    pub(crate) fn for_process(process: HANDLE) -> io::Result<Self> {
        let mut token = Token(HANDLE::default());
        unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token.0) }.map_err(win)?;
        let mut size = 0;
        unsafe {
            let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
        }
        if size == 0 {
            return Err(denied());
        }
        let mut storage = vec![0u64; (size as usize + 7) / 8];
        unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                Some(storage.as_mut_ptr().cast()),
                size,
                &mut size,
            )
        }
        .map_err(win)?;
        Ok(Self { storage })
    }
    pub(crate) fn matches(&self, other: &Self) -> bool {
        unsafe { EqualSid(self.sid(), other.sid()) }.is_ok()
    }
    fn sid(&self) -> PSID {
        unsafe { (*(self.storage.as_ptr().cast::<TOKEN_USER>())).User.Sid }
    }
    fn sid_string(&self) -> io::Result<String> {
        let mut value = PWSTR::null();
        unsafe { ConvertSidToStringSidW(self.sid(), &mut value) }.map_err(win)?;
        let result = unsafe { value.to_string() }.map_err(|_| denied());
        unsafe {
            LocalFree(Some(HLOCAL(value.0.cast())));
        }
        result
    }
    pub(crate) fn security(&self) -> io::Result<Local> {
        // Modify includes SYNCHRONIZE, READ_CONTROL and DELETE, but not WRITE_DAC/OWNER.
        let text = format!(
            "O:{}D:P(A;OICI;0x1301bf;;;{})(A;OICI;FA;;;SY)",
            self.sid_string()?,
            self.sid_string()?
        );
        let text: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(text.as_ptr()),
                1,
                &mut descriptor,
                None,
            )
        }
        .map_err(win)?;
        Ok(Local(descriptor))
    }
    pub(crate) fn validate(&self, file: &File, private: bool, directory: bool) -> io::Result<()> {
        self.validate_inner(file, private, directory, private)
    }
    /// Installation destinations must actually belong to this user, even though
    /// profile roots may accept a SYSTEM or Administrators owner.
    pub(crate) fn validate_owned_directory(&self, file: &File) -> io::Result<()> {
        self.validate_inner(file, false, true, true)
    }
    fn validate_inner(
        &self,
        file: &File,
        private: bool,
        directory: bool,
        user_owner: bool,
    ) -> io::Result<()> {
        let mut owner = PSID::default();
        let mut acl: *mut ACL = std::ptr::null_mut();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        let result = unsafe {
            GetSecurityInfo(
                HANDLE(file.as_raw_handle()),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                Some(&mut owner),
                None,
                Some(&mut acl),
                None,
                Some(&mut descriptor),
            )
        };
        if result.0 != 0 {
            return Err(io::Error::from_raw_os_error(result.0 as i32));
        }
        let _descriptor = Local(descriptor);
        let owner_text = sid_text(owner)?;
        let user_text = self.sid_string()?;
        if owner_text != user_text
            && (user_owner || !matches!(owner_text.as_str(), "S-1-5-18" | "S-1-5-32-544"))
        {
            return Err(denied());
        }
        if acl.is_null() {
            return Err(denied());
        }
        let mut control = 0;
        let mut revision = 0;
        unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) }
            .map_err(win)?;
        if private && directory && control & SE_DACL_PROTECTED.0 == 0 {
            return Err(denied());
        }
        let mut user_rights = 0;
        let mut system_rights = 0;
        for index in 0..unsafe { (*acl).AceCount } {
            let mut raw = std::ptr::null_mut();
            unsafe { GetAce(acl, index as u32, &mut raw) }.map_err(win)?;
            let ace = unsafe { &*raw.cast::<ACCESS_ALLOWED_ACE>() };
            // Only simple allow ACEs have an established interpretation here.
            if ace.Header.AceType != 0 {
                return Err(denied());
            }
            let sid = PSID((&ace.SidStart as *const u32).cast_mut().cast());
            let text = sid_text(sid)?;
            let rights = normalized_rights(ace.Mask);
            if private {
                if text != user_text && text != "S-1-5-18" {
                    return Err(denied());
                }
                if text == user_text && rights & !0x1301bf != 0 {
                    return Err(denied());
                }
                if ace.Header.AceFlags & 8 == 0 {
                    if unsafe { EqualSid(sid, self.sid()) }.is_ok() {
                        user_rights |= rights;
                    }
                    if text == "S-1-5-18" {
                        system_rights |= rights;
                    }
                }
            } else if ace.Header.AceFlags & 8 == 0
                && text != user_text
                && !matches!(text.as_str(), "S-1-5-18" | "S-1-5-32-544")
            {
                // Other principals may read/traverse the profile, but cannot mutate it.
                let dangerous = 0x2 | 0x4 | 0x10 | 0x40 | 0x100 | 0x10000 | 0x40000 | 0x80000;
                if rights & dangerous != 0 {
                    return Err(denied());
                }
            }
        }
        if private && (user_rights & 0x1301bf != 0x1301bf || system_rights & 0x1f01ff != 0x1f01ff) {
            return Err(denied());
        }
        Ok(())
    }
}
fn sid_text(sid: PSID) -> io::Result<String> {
    let mut value = PWSTR::null();
    unsafe { ConvertSidToStringSidW(sid, &mut value) }.map_err(win)?;
    let result = unsafe { value.to_string() }.map_err(|_| denied());
    unsafe {
        LocalFree(Some(HLOCAL(value.0.cast())));
    }
    result
}
fn normalized_rights(mut rights: u32) -> u32 {
    for (generic, specific) in [
        (0x80000000, 0x120089),
        (0x40000000, 0x120116),
        (0x20000000, 0x1200a0),
        (0x10000000, 0x1f01ff),
    ] {
        if rights & generic != 0 {
            rights = (rights & !generic) | specific;
        }
    }
    rights
}
impl Local {
    pub(crate) fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0 .0,
            bInheritHandle: false.into(),
        }
    }
}

/// Read-only: obtaining this identity never creates a coordination object.
pub(super) fn permanent_root() -> io::Result<(PathBuf, Vec<File>)> {
    let mut token = Token(HANDLE::default());
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token.0) }.map_err(win)?;
    let mut flags = 0;
    unsafe { GetProfileType(&mut flags) }.map_err(win)?;
    // Roaming, mandatory, temporary and unknown profile modes are not established.
    if flags != 0 {
        return Err(denied());
    }
    let mut size = 0;
    unsafe {
        let _ = GetUserProfileDirectoryW(token.0, None, &mut size);
    }
    if size == 0 {
        return Err(denied());
    }
    let mut text = vec![0u16; size as usize];
    unsafe { GetUserProfileDirectoryW(token.0, Some(PWSTR(text.as_mut_ptr())), &mut size) }
        .map_err(win)?;
    let length = text.iter().position(|c| *c == 0).ok_or_else(denied)?;
    let root = PathBuf::from(OsString::from_wide(&text[..length]));
    let user = User::current()?;
    let key = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey_with_flags(
        format!(
            "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\{}",
            user.sid_string()?
        ),
        winreg::enums::KEY_READ | winreg::enums::KEY_WOW64_64KEY,
    )?;
    let registered: String = key.get_value("ProfileImagePath")?;
    // Never expand mutable process environment variables. Ambiguous registry paths fail closed.
    if registered.contains('%') {
        return Err(denied());
    }
    let registered = Path::new(&registered);
    let mut original = super::pin_directories(&root)?;
    let recorded = super::pin_directories(registered)?;
    let actual = super::information(original.last().ok_or_else(denied)?)?;
    let expected = super::information(recorded.last().ok_or_else(denied)?)?;
    if super::identity(&actual) != super::identity(&expected) || !same_path(&root, registered) {
        return Err(denied());
    }
    original.extend(recorded);
    Ok((root, original))
}
fn same_path(a: &Path, b: &Path) -> bool {
    a.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_generic_rights_include_synchronize() {
        assert_eq!(normalized_rights(0xe0010000), 0x1301bf);
        assert_eq!(normalized_rights(0x10000000), 0x1f01ff);
    }
}
