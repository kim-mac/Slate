use std::io::{self, Read, Write};

use crate::clips::ClipService;

use super::protocol::{decode_capture_request, BridgeErrorCode, BridgeResponse};

pub const MAX_MESSAGE_BYTES: u32 = 1024 * 1024;

pub fn run_once<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    service: &ClipService,
) -> io::Result<()> {
    let mut prefix = [0_u8; 4];
    if reader.read_exact(&mut prefix).is_err() {
        return write_response(
            writer,
            &BridgeResponse::failure(BridgeErrorCode::MalformedMessage),
        );
    }

    let body_length = u32::from_ne_bytes(prefix);
    if body_length > MAX_MESSAGE_BYTES {
        return write_response(
            writer,
            &BridgeResponse::failure(BridgeErrorCode::MessageTooLarge),
        );
    }

    let mut body = vec![0_u8; body_length as usize];
    if reader.read_exact(&mut body).is_err() {
        return write_response(
            writer,
            &BridgeResponse::failure(BridgeErrorCode::MalformedMessage),
        );
    }

    let response = match decode_capture_request(&body) {
        Ok(input) => match service.create(input) {
            Ok(clip) => BridgeResponse::success(clip.id),
            Err(_) => BridgeResponse::failure(BridgeErrorCode::StorageUnavailable),
        },
        Err(error) => BridgeResponse::failure(error),
    };
    write_response(writer, &response)
}

pub fn write_response<W: Write>(writer: &mut W, response: &BridgeResponse) -> io::Result<()> {
    let body = serde_json::to_vec(response).map_err(io::Error::other)?;
    let body_length = u32::try_from(body.len()).map_err(io::Error::other)?;
    writer.write_all(&body_length.to_ne_bytes())?;
    writer.write_all(&body)?;
    writer.flush()
}
