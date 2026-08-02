import { getD1 } from "../db";

export async function runGovernanceMaintenance(){
  const db=getD1();
  const due=await db.prepare(`SELECT d.id,d.title,d.owner_user_id,d.create_user_id,d.dept_id FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND d.review_due_at IS NOT NULL AND d.review_due_at<=date('now','+30 day') LIMIT 100`).all<Record<string,unknown>>();
  for(const doc of due.results){const receiver=Number(doc.owner_user_id||doc.create_user_id);await db.prepare(`INSERT INTO notifications(user_id,type,title,content,document_id) SELECT ?,'REVIEW_DUE','知识即将到期复核',?,? WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE user_id=? AND type='REVIEW_DUE' AND document_id=? AND create_time>=date('now','-30 day'))`).bind(receiver,`《${doc.title}》需在复核日期前确认有效性`,doc.id,receiver,doc.id).run();}
  const setting=await db.prepare("SELECT value FROM system_settings WHERE key='governance.auto_expire'").first<{value:string}>().catch(()=>null);
  let expired=0;if(setting?.value!=="0"){const result=await db.prepare(`UPDATE documents SET status='EXPIRED_VOID',verification_status='EXPIRED',update_time=CURRENT_TIMESTAMP WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' AND review_due_at IS NOT NULL AND review_due_at<date('now')`).run();expired=Number(result.meta.changes||0);}
  const orphaned=await db.prepare(`SELECT d.id,d.title,d.dept_id,d.owner_user_id FROM documents d LEFT JOIN users owner ON owner.id=d.owner_user_id WHERE d.is_deleted=0 AND d.owner_user_id IS NOT NULL AND (owner.id IS NULL OR owner.status<>'ACTIVE') LIMIT 100`).all<Record<string,unknown>>();
  let transferred=0;for(const doc of orphaned.results){const replacement=await db.prepare(`SELECT u.id,u.display_name FROM users u JOIN user_departments ud ON ud.user_id=u.id WHERE ud.dept_id=? AND u.status='ACTIVE' ORDER BY ud.is_dept_admin DESC,u.id LIMIT 1`).bind(doc.dept_id).first<{id:number;display_name:string}>();if(!replacement)continue;await db.batch([db.prepare("UPDATE documents SET owner_user_id=?,owner=?,update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(replacement.id,replacement.display_name,replacement.id,doc.id),db.prepare("INSERT INTO notifications(user_id,type,title,content,document_id) VALUES(?,'OWNER_TRANSFER','离职知识已自动转交',?,?)").bind(replacement.id,`《${doc.title}》已转交给你维护`,doc.id)]);transferred++;}
  return{due:due.results.length,expired,transferred};
}
