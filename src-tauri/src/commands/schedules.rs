// Person A: schedule block CRUD + open_app/close_app commands.
// Contract (see src/shared/types.ts):
//   create_schedule_block(block: ScheduleBlock) -> ScheduleBlock
//   list_schedule_blocks() -> Vec<ScheduleBlock>
//   delete_schedule_block(id: String) -> ()
//   get_active_block() -> Option<ScheduleBlock>
//   open_app(path: String) -> Result<(), String>
//   close_app(process_name: String) -> Result<(), String>
