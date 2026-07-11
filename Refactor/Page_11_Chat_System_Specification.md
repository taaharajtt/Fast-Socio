# Page 11 --- Chat System Specification

## Purpose

The Chat System provides secure, real-time communication between
students through direct messages, groups, societies, departments,
semesters, and event channels. Every conversation supports rich media,
presence indicators, moderation, notifications, and synchronization
across devices.

## Conversation Types

Direct messages, Matches, Group Chats, Society Channels, Department
Rooms, Semester Rooms, Event Chats, Study Groups, Temporary Rooms.

## Features

Text, images, videos, GIFs, stickers, voice notes, files, PDFs, polls,
code snippets, locations, contacts, event cards, replies, threads,
reactions, pins, bookmarks, forwarding, editing, unsending, scheduled
messages, disappearing messages, message search, media gallery, shared
links, typing indicators, delivery/read receipts, online status, mute,
archive, custom themes, emoji packs, voice/video calls, screen sharing,
and spam reporting.

## Backend Logic

Each message receives a unique ID, timestamps, delivery state, sender,
attachments, reactions, edit history, moderation state, and encryption
metadata. WebSockets synchronize messages instantly while offline
messages queue locally until reconnection.

## Moderation

Report messages, block users, automatic spam detection, profanity
filtering, flood control, audit logging, and administrator moderation.

## Navigation

Home → Chat List → Conversation → Media / Profile / Call / Search
