use crate::domain::meeting::{Meeting, MeetingDetails};
use anyhow::Result;

pub trait Database: Send + Sync {
    fn get_meetings(&self) -> Result<Vec<Meeting>>;
    fn get_meeting_details(&self, meeting_id: i64) -> Result<MeetingDetails>;
}
