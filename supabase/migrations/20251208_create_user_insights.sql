-- Create user_insights table
create table if not exists public.user_insights (
    id uuid not null default uuid_generate_v4(),
    user_id uuid null,
    phone text null,
    title text null,
    summary text null,
    insights jsonb null,
    sent_via text null, -- 'whatsapp', 'app', etc
    sent_at timestamp with time zone null,
    metadata jsonb null default '{}'::jsonb,
    created_at timestamp with time zone not null default now(),
    constraint user_insights_pkey primary key (id),
    constraint user_insights_user_id_fkey foreign key (user_id) references profiles(id) on delete cascade
);

-- Enable RLS
alter table public.user_insights enable row level security;

-- Create Policy
create policy "Users can view their own insights"
    on public.user_insights
    for select
    using (auth.uid() = user_id);

-- Grant permissions (adjust as needed for authenticated/service_role)
grant all on table public.user_insights to authenticated;
grant all on table public.user_insights to service_role;
