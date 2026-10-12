use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
}

#[tauri::command]
pub async fn pick_document(app_handle: tauri::AppHandle) -> Result<Option<PickedFile>, String> {
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("Documents", &["pdf", "txt", "md", "docx", "csv"])
        .blocking_pick_file();

    if let Some(path) = file_path {
        let path_buf = path.into_path().map_err(|_| "Failed to resolve path")?;
        let path_str = path_buf.to_string_lossy().to_string();
        let file_name = path_buf
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let bytes = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);

        Ok(Some(PickedFile {
            path: path_str,
            file_name,
            bytes,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn upload_document(
    app: tauri::AppHandle,
    chat: tauri::State<'_, std::sync::Arc<dyn crate::ports::chat_gateway::ChatGatewayClient>>,
    path: String,
    file_name: String,
    doc_id: String,
) -> Result<(), String> {
    let app_clone = app.clone();
    chat.start_session(Box::new(move |text| {
        crate::sidecar::chat_events::route_chat_event(&app_clone, &text);
    }))
    .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "type": "UploadDocument",
        "filePath": path,
        "fileName": file_name,
        "docId": doc_id,
    });

    chat.send(payload.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_documents(
    app: tauri::AppHandle,
    chat: tauri::State<'_, std::sync::Arc<dyn crate::ports::chat_gateway::ChatGatewayClient>>,
) -> Result<(), String> {
    let app_clone = app.clone();
    chat.start_session(Box::new(move |text| {
        crate::sidecar::chat_events::route_chat_event(&app_clone, &text);
    }))
    .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "type": "ListDocuments",
    });

    chat.send(payload.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_document(
    app: tauri::AppHandle,
    chat: tauri::State<'_, std::sync::Arc<dyn crate::ports::chat_gateway::ChatGatewayClient>>,
    doc_id: String,
) -> Result<(), String> {
    let app_clone = app.clone();
    chat.start_session(Box::new(move |text| {
        crate::sidecar::chat_events::route_chat_event(&app_clone, &text);
    }))
    .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "type": "DeleteDocument",
        "docId": doc_id,
    });

    chat.send(payload.to_string()).map_err(|e| e.to_string())
}
