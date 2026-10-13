// The public contact email is not the Supabase Auth account email.
export function buildBusinessProfileUpdate(form, current = {}) {
  const name=String(form?.name||"").trim();
  const email=String(form?.email||"").trim().toLowerCase();
  if(name.length<2||name.length>160) throw new Error("A valid business name is required");
  if(email && (email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Invalid public contact email");
  }
  const phone=String(form?.phone||"").trim();
  const website=String(form?.website||"").trim();
  if(phone.length>80||website.length>255) throw new Error("Business contact details are too long");
  return {
    ...(current||{}),
    name,business:name,
    businessType:form?.category||"Other",
    customBusinessType:form?.category==="Other"?String(form?.customBusinessType||"").trim():"",
    contactEmail:email,phone,website,
    serviceName:String(form?.serviceName||"").trim(),
    price:String(form?.price||"").trim(),
    hours:String(form?.hours||"").trim(),
    description:String(form?.description||"").trim(),
  };
}
